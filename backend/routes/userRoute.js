const router = require("express").Router();
const jwt = require("jsonwebtoken");
const bcryptjs = require("bcryptjs");
const User = require("../models/userModel");
const crypto = require("crypto");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/requireAuth");
const { broadcastProfile, broadcastPhoto } = require("../services/profileEvents");
const {
  signinLimiter,
  signupLimiter,
  usernameCheckLimiter,
  profileUpdateLimiter,
  passwordChangeLimiter,
} = require("../middleware/rateLimit");

// ── Session timing — bank-style (OWASP session guidance / FFIEC) ──────────
//   Access token    5 minutes. Sent with every API call; kept in memory only.
//   Idle timeout   15 minutes. The refresh token — and its cookie — lasts 15
//                  minutes and is single use: every refresh swaps it for a
//                  new one. The app only refreshes while someone is actually
//                  using it (frontend/src/auth/AuthProvider.jsx), so 15
//                  minutes without activity ends the session.
//   Absolute        8 hours from sign-in, then sign in again regardless.
// A refresh token that was already swapped coming back later means it was
// copied (stolen) — the whole session is ended.
const ACCESS_TOKEN_TTL_S = 5 * 60;
const IDLE_TIMEOUT_S = 15 * 60;
const ABSOLUTE_SESSION_S = 8 * 60 * 60;
// A refresh whose answer never arrived (network blip) may be retried with
// the just-replaced token for this long without counting as theft
const REUSE_GRACE_MS = 30 * 1000;
const SESSION_OVER = "Your session has ended. Please sign in again.";

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  path: "/auth",
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const nowSeconds = () => Math.floor(Date.now() / 1000);

const signAccessToken = (user) =>
  jwt.sign({ id: user.id }, process.env.MYACCESSKEY, { expiresIn: ACCESS_TOKEN_TTL_S });

// A new single-use refresh token for the session that started at `started`
// (seconds): good for the idle window, never past the 8-hour limit. Returns
// { token, hash, lifetime } — lifetime 0 means the session is out of time.
function newRefreshToken(userId, started) {
  const lifetime = Math.min(IDLE_TIMEOUT_S, started + ABSOLUTE_SESSION_S - nowSeconds());
  if (lifetime <= 0) return { lifetime: 0 };
  // jti: two tokens made in the same second still differ
  const token = jwt.sign({ id: userId, sst: started, jti: crypto.randomUUID() }, process.env.MYREFRESHKEY, {
    expiresIn: lifetime,
  });
  return { token, hash: hashToken(token), lifetime };
}

// The cookie expires with the token inside it (at most 15 minutes)
function setRefreshCookie(res, { token, lifetime }) {
  res.cookie("refreshToken", token, { ...refreshCookieOptions, maxAge: lifetime * 1000 });
}

// What the frontend needs to time the session: the idle window and when the
// 8-hour limit runs out (ms since epoch)
const sessionInfo = (started) => ({
  idleTimeoutMs: IDLE_TIMEOUT_S * 1000,
  expiresAt: (started + ABSOLUTE_SESSION_S) * 1000,
});

// Used by /signin: a brand-new session (any earlier one — e.g. on another
// device — is replaced). Sets the refresh cookie; returns the access token
// and session timing.
async function startSession(user, res) {
  const started = nowSeconds();
  const refresh = newRefreshToken(user.id, started);
  user.refreshToken = refresh.hash;
  user.prevRefreshToken = null;
  user.refreshRotatedAt = null;
  await user.save();
  setRefreshCookie(res, refresh);
  return { accessToken: signAccessToken(user), session: sessionInfo(started) };
}

// Ends the session on the server (sign-out, theft, out of time)
const revokeSession = (userId) =>
  User.updateOne(
    { _id: userId },
    { $set: { refreshToken: null, prevRefreshToken: null, refreshRotatedAt: null } },
  );

router.get(
  "/username-available",
  usernameCheckLimiter,
  validate("usernameQuery", "query"),
  async (req, res) => {
    const userName = req.validated.username;
    try {
      const exists = await User.exists({ userName }).collation(
        User.USERNAME_COLLATION,
      );
      res.status(200).json({ available: !exists });
    } catch (error) {
      res.status(500).json({ error: "Unable to check username" });
    }
  },
);

router.post("/signup", signupLimiter, validate("signup"), async (req, res) => {
  const {
    firstName,
    lastName,
    userName,
    email,
    password,
    occupation,
    school,
    major,
    graduated,
  } = req.validated;

  try {
    const hashedPassword = await bcryptjs.hash(password, 12);

    const user = await User.create({
      firstName: firstName,
      lastName: lastName,
      userName: userName,
      email: email,
      occupation: occupation,
      school: school,
      major: major,
      graduated: graduated,
      password: hashedPassword,
    });

    // Signing up only saves the account — no tokens or cookie. The user
    // signs in through /signin afterwards.
    res.status(201).json({
      user: user.toPublic(),
      message: "Successfully signed up!",
    });
  } catch (error) {
    // Duplicate username or email
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
      return res.status(409).json({
        message: `That ${field === "userName" ? "username" : field} is already taken.`,
        field,
      });
    }
    // Schema validation failed — report the first problem
    if (error.name === "ValidationError") {
      const [field, detail] = Object.entries(error.errors)[0];
      return res.status(400).json({ message: detail.message, field });
    }
    res.status(500).json({
      message: "Server error during signup!",
    });
  }
});

router.post("/signin", signinLimiter, validate("signin"), async (req, res) => {
  try {
    const { userName, password } = req.validated;
    // Usernames are case-insensitive: "Chris" signs in as "chris"
    const user = await User.findOne({ userName }).collation(
      User.USERNAME_COLLATION,
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const { accessToken, session } = await startSession(user, res);

    res.status(200).json({
      user: user.toPublic(),
      accessToken,
      session,
      message: "You have signed in successfully!",
    });
  } catch (error) {
    res.status(500).json({
      error: "unable to sign In server issue!",
    });
  }
});

router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) return res.sendStatus(204);

  try {
    const hash = hashToken(refreshToken);
    const user = await User.findOne({
      $or: [{ refreshToken: hash }, { prevRefreshToken: hash }],
    }).select("_id");
    if (user) await revokeSession(user._id);
  } catch (error) {
    console.error("Logout Db Error", error.message);
  }
  res.clearCookie("refreshToken", refreshCookieOptions);
  res.status(200).json({
    message: "You have Logged out succssfully!",
  });
});

// New access token + new single-use refresh token (rotation), from the
// refresh cookie. Ends the session when it's out of time, or when an old,
// already-swapped token is used again (it was copied).
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: "No refresh token" });
  }

  const endSession = async (userId, message = SESSION_OVER) => {
    if (userId) await revokeSession(userId).catch(() => {});
    res.clearCookie("refreshToken", refreshCookieOptions);
    return res.status(403).json({ error: message });
  };

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.MYREFRESHKEY);
  } catch {
    // Expired (15 minutes idle), tampered with, or signed with another key
    return endSession(null);
  }

  try {
    const started = decoded.sst;
    // Older tokens (before session limits) carry no start time
    if (!Number.isFinite(started)) return endSession(decoded.id);
    const next = newRefreshToken(decoded.id, started);
    if (!next.lifetime) return endSession(decoded.id); // past 8 hours

    const presented = hashToken(refreshToken);
    // Swap atomically: only the current token can be exchanged, once
    let user = await User.findOneAndUpdate(
      { _id: decoded.id, refreshToken: presented },
      { $set: { refreshToken: next.hash, prevRefreshToken: presented, refreshRotatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!user) {
      const holder = await User.findById(decoded.id).select(
        "refreshToken prevRefreshToken refreshRotatedAt",
      );
      const justReplaced =
        holder?.refreshToken &&
        holder.prevRefreshToken === presented &&
        Date.now() - holder.refreshRotatedAt < REUSE_GRACE_MS;
      if (!justReplaced) {
        // Signed out, signed in elsewhere, or an old token used again
        return endSession(holder?.refreshToken ? decoded.id : null);
      }
      // The answer to the last refresh was lost: swap the current one instead
      user = await User.findOneAndUpdate(
        { _id: decoded.id, refreshToken: holder.refreshToken },
        { $set: { refreshToken: next.hash, prevRefreshToken: presented, refreshRotatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!user) return endSession(null);
    }

    setRefreshCookie(res, next);
    res.status(200).json({
      accessToken: signAccessToken(user),
      user: user.toPublic(),
      session: sessionInfo(started),
    });
  } catch (error) {
    console.error("Refresh failed:", error);
    res.status(500).json({ error: "Unable to refresh session" });
  }
});

// The signed-in user's profile. Example of a protected route: requireAuth
// rejects the request unless it carries a valid access token.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user: user.toPublic() });
  } catch (error) {
    res.status(500).json({ error: "Unable to load profile" });
  }
});

// ── Edit Profile ──────────────────────────────────────────────────────────

// Duplicate username/email → 409 { message, field }; schema problems → 400
function profileSaveError(error, res) {
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
    return res.status(409).json({
      message: `That ${field === "userName" ? "username" : field} is already taken.`,
      field,
    });
  }
  if (error.name === "ValidationError") {
    const [field, detail] = Object.entries(error.errors)[0];
    return res.status(400).json({ message: detail.message, field });
  }
  return res.status(500).json({ message: "Unable to save your profile." });
}

// Update your account details (all fields are sent; see validate("profile"))
router.patch(
  "/me",
  requireAuth,
  profileUpdateLimiter,
  validate("profile"),
  async (req, res) => {
    try {
      const user = await User.findByIdAndUpdate(req.userId, req.validated, {
        returnDocument: "after",
        runValidators: true,
      });
      if (!user) return res.status(404).json({ message: "User not found." });
      res.status(200).json({ user: user.toPublic(), message: "Profile saved." });
      broadcastProfile(user);
    } catch (error) {
      if (error.code !== 11000 && error.name !== "ValidationError") {
        console.error("Profile update failed:", error);
      }
      profileSaveError(error, res);
    }
  },
);

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const AVATAR_MAX_CHARS = 150000; // ≈110 KB image

// Set ({ avatar: "data:image/jpeg;base64,…" }) or remove ({ avatar: null })
router.put("/me/avatar", requireAuth, profileUpdateLimiter, async (req, res) => {
  const avatar = req.body?.avatar;
  if (
    avatar !== null &&
    (typeof avatar !== "string" ||
      avatar.length > AVATAR_MAX_CHARS ||
      !AVATAR_RE.test(avatar))
  ) {
    return res.status(400).json({
      message: "Photo must be a JPG, PNG or WEBP image under 110 KB.",
      field: "avatar",
    });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      // A new version on every change, so every cached copy is replaced
      { avatar, photoVersion: avatar ? Date.now() : null },
      { returnDocument: "after", runValidators: true },
    );
    if (!user) return res.status(404).json({ message: "User not found." });
    res.status(200).json({ user: user.toPublic() });
    broadcastProfile(user);
    broadcastPhoto(user);
  } catch (error) {
    console.error("Avatar update failed:", error);
    res.status(500).json({ message: "Unable to save your photo." });
  }
});

// Change password: needs the current one. 400 (not 401) on a wrong current
// password, so the frontend doesn't treat it as an expired session.
router.post(
  "/password",
  requireAuth,
  passwordChangeLimiter,
  validate("passwordChange"),
  async (req, res) => {
    const { currentPassword, newPassword } = req.validated;
    try {
      const user = await User.findById(req.userId);
      if (!user) return res.status(404).json({ message: "User not found." });
      if (!(await bcryptjs.compare(currentPassword, user.password))) {
        return res.status(400).json({
          message: "Your current password is incorrect.",
          field: "currentPassword",
        });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({
          message: "Choose a password you haven't used here before.",
          field: "newPassword",
        });
      }
      user.password = await bcryptjs.hash(newPassword, 12);
      // A fresh session for this browser: any copied / older refresh token
      // stops working, as at a bank after a password change
      const { accessToken, session } = await startSession(user, res);
      res.status(200).json({ message: "Password updated.", accessToken, session });
    } catch (error) {
      console.error("Password change failed:", error);
      res.status(500).json({ message: "Unable to change your password." });
    }
  },
);

module.exports = router;
