require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();

const { rejectInjection } = require("./middleware/security");

// In production, requests arrive through Railway's proxy: use the visitor's
// real IP (from X-Forwarded-For) so rate limits are per person, not shared
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(helmet());
// Bodies are small JSON; anything larger is refused before a route sees it
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
// Refuse MongoDB operator / prototype-pollution keys anywhere in a request
// (body, query string, URL params) — see middleware/security.js
app.use(rejectInjection);
// Query filters only ever match fields that exist on the model
mongoose.set("strictQuery", true);
// Frontend address(es) allowed to call the API with cookies. Set CLIENT_ORIGIN
// in production, comma-separated for more than one.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());
app.use(cors({ credentials: true, origin: allowedOrigins }));

// Railway's health check (railway.toml): up once the database is connected
app.get("/health", (req, res) => {
  res.sendStatus(mongoose.connection.readyState === 1 ? 200 : 503);
});

const userRoutes = require("./routes/userRoute");
app.use("/auth", userRoutes);
// Browse Skills: member profiles and friends (all require sign-in)
app.use("/members", require("./routes/memberRoute"));
app.use("/friends", require("./routes/friendRoute"));
// Live Sessions: invite-only video rooms (require sign-in)
app.use("/sessions", require("./routes/sessionRoute"));
// Live Session notes: links, PDFs and images the host shares
app.use("/sessionNotes", require("./routes/sessionNotesRoute"));
// Live Session chat: messages, replies and reactions for people in a session
app.use("/sessionChat", require("./routes/sessionChatRoute"));
// The navbar bell: saved notifications (also pushed live over Socket.IO)
app.use("/notifications", require("./routes/notificationRoute"));
// Profile photos as images (public: <img> can't send a token)
app.use("/avatars", require("./routes/avatarRoute"));
// Messages tab: the shared message board (posts, replies, likes, images)
app.use("/messageBoard", require("./routes/messageBoardRoute"));
// Swap Requests: skill swaps between members (require sign-in)
app.use("/swaps", require("./routes/swapRoute"));

Port = process.env.PORT || 4000;
const Database = process.env.MONGODB;

const db = mongoose.connection;

db.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

db.once("open", () => {
  console.log("**MongoDb is Running**");
  // Photos uploaded before photo versions existed: give them one, so they
  // show up through GET /avatars/:id (safe to run every start)
  require("./models/userModel")
    .updateMany(
      { avatar: { $ne: null }, photoVersion: null },
      { $set: { photoVersion: Date.now() } },
    )
    .catch((err) => console.error("Photo version backfill failed:", err));
});

// Socket.IO (Live Sessions signaling) shares the HTTP server with Express.
const { attachSignaling } = require("./signaling");
const server = http.createServer(app);
attachSignaling(server, allowedOrigins);

server.listen(Port, () => {
  console.log(`***Server is Running***`);
});

mongoose.connect(Database);
