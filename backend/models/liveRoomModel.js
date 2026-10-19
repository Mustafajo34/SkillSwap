const crypto = require("crypto");
const mongoose = require("mongoose");

// A Live Session (video room). Sessions are invite-only: the signaling
// server lets someone into the room only if they're the host or on the
// `invited` list. People get on the list by being invited by name, or by
// opening the host's invite link, which carries the secret `inviteCode`.
// Sessions expire after a day (MongoDB removes them via the TTL index).

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const liveRoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    invited: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Everyone who actually got into the call (set by signaling.js) — the
    // people who can rate each other once it's over
    attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    inviteCode: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    // Set when the call is over (see signaling.js). An ended session can't
    // be joined, viewed or invited to again — start a new one instead.
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

liveRoomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// 16 base-36 characters (matches the room id rule in signaling.js)
const newRoomId = () =>
  Array.from(crypto.randomBytes(16), (b) => (b % 36).toString(36)).join("");

// 192 random bits, URL-safe — the secret part of an invite link
const newInviteCode = () => crypto.randomBytes(24).toString("base64url");

liveRoomSchema.statics.createFor = function createFor(hostId) {
  return this.create({
    roomId: newRoomId(),
    host: hostId,
    invited: [],
    inviteCode: newInviteCode(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
};

// The session if it still exists, hasn't expired and hasn't ended
liveRoomSchema.statics.findActive = function findActive(filter) {
  return this.findOne({ ...filter, endedAt: null, expiresAt: { $gt: new Date() } });
};

liveRoomSchema.methods.isHost = function isHost(userId) {
  return String(this.host) === String(userId);
};

liveRoomSchema.methods.canJoin = function canJoin(userId) {
  return (
    this.isHost(userId) ||
    this.invited.some((id) => String(id) === String(userId))
  );
};

liveRoomSchema.statics.INVITE_CODE_RE = /^[A-Za-z0-9_-]{32}$/;

module.exports = mongoose.model("LiveRoom", liveRoomSchema);
