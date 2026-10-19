const crypto = require("crypto");
const mongoose = require("mongoose");

// Images for messageBoard posts, stored apart from the posts themselves
// ("messageBoardImages" collection). An image is uploaded first, then
// attached to a post when it's published. Images that never get attached
// (upload then cancel) are removed after a day by the TTL index; attaching
// clears expiresAt so they stay.
//
// `key` is a random secret that's part of the image's URL, so <img> tags can
// load it without a sign-in token but nobody can guess the address.

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;
const UNATTACHED_TTL_MS = 24 * 60 * 60 * 1000;

const imageSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "MessageBoardPost", default: null },
    key: { type: String, required: true, default: () => crypto.randomBytes(16).toString("hex") },
    contentType: { type: String, enum: IMAGE_TYPES, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true, max: IMAGE_MAX_BYTES },
    expiresAt: { type: Date, default: () => new Date(Date.now() + UNATTACHED_TTL_MS) },
  },
  { timestamps: true, collection: "messageBoardImages" },
);

imageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
imageSchema.index({ owner: 1, post: 1 });

// Path the frontend loads the image from (prefixed with the API address)
imageSchema.methods.urlPath = function urlPath() {
  return `/messageBoard/images/${this.id}?k=${this.key}`;
};

imageSchema.statics.IMAGE_TYPES = IMAGE_TYPES;
imageSchema.statics.IMAGE_MAX_BYTES = IMAGE_MAX_BYTES;

// Is this buffer really the image type it claims? (Checks the file's first
// bytes, so a renamed file or a script can't pass as an image.)
imageSchema.statics.matchesType = (buffer, contentType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const hex = buffer.subarray(0, 12).toString("hex");
  switch (contentType) {
    case "image/jpeg":
      return hex.startsWith("ffd8ff");
    case "image/png":
      return hex.startsWith("89504e470d0a1a0a");
    case "image/gif":
      return buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
        buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    case "image/webp":
      return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
};

module.exports = mongoose.model("MessageBoardImage", imageSchema);
