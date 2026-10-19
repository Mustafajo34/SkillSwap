const mongoose = require("mongoose");

// Something that happened to a user: a video invite, a reply to one, a
// connect request… Saved so people who were offline still see it, and pushed
// live over Socket.IO when they're online (services/notifications.js).
// Old notifications are removed after 30 days (TTL index).

const NOTIFICATION_TYPES = [
  "session_invite", // someone invited you to a video session
  "session_response", // someone accepted/declined your video invite
  "session_link_join", // someone joined your session with your invite link
  "connect_request", // someone wants to connect
  "connect_accept", // someone accepted your connect request
  "swap_request", // someone proposed a skill swap
  "swap_response", // a swap of yours was accepted/declined/cancelled/completed
  "session_recording", // the host started recording a video session you're in
  "session_rating", // someone rated you after a video session
];

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      name: { type: String, required: true },
      photoV: { type: Number, default: null },
    },
    // Type-specific details, e.g. { roomId, sessionExpiresAt } or { response }
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
    expiresAt: { type: Date, default: () => new Date(Date.now() + KEEP_MS) },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// What the client sees
notificationSchema.methods.toView = function toView() {
  return {
    id: this.id,
    type: this.type,
    actor: {
      id: String(this.actor.id),
      name: this.actor.name,
      photoV: this.actor.photoV || null,
    },
    data: this.data || {},
    read: this.read,
    createdAt: this.createdAt,
  };
};

notificationSchema.statics.TYPES = NOTIFICATION_TYPES;

module.exports = mongoose.model("Notification", notificationSchema);
