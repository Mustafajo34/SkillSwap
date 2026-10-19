const mongoose = require("mongoose");

// Live Session chat (the Chat button): messages between everyone in one
// session ("sessionChat" collection). A message can reply to another one,
// and people can react with one of four emoji. Messages are deleted when
// the session ends (signaling.js), and expire with it otherwise (TTL index).

const CHAT_REACTIONS = ["smile", "thumbs", "fire", "wow"];
const BODY_MAX = 500;

const sessionChatSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, maxLength: BODY_MAX },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "SessionChatMessage", default: null },
    // emoji key → ids of the people who reacted with it
    reactions: {
      smile: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      thumbs: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      fire: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      wow: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "sessionChat" },
);

sessionChatSchema.index({ roomId: 1, createdAt: -1 });
sessionChatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionChatSchema.statics.CHAT_REACTIONS = CHAT_REACTIONS;
sessionChatSchema.statics.BODY_MAX = BODY_MAX;

module.exports = mongoose.model("SessionChatMessage", sessionChatSchema);
