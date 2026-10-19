const crypto = require("crypto");
const mongoose = require("mongoose");

// Live Session notes (the Notes button): links, PDFs and images the host
// shares with everyone in their session ("sessionNotes" collection). Only
// the host adds or removes them; everyone in the session can open links and
// download files. Notes disappear with the session (same expiry, TTL index).
//
// Files are stored in the document. `key` is a random secret that's part of
// a file's URL, so <img> tags and download links work without a sign-in
// token but nobody can guess the address — and only people in the session
// are ever given it.

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const FILE_MAX_BYTES = 8 * 1024 * 1024;

const sessionNoteSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["link", "image", "pdf"], required: true },
    // Links
    url: { type: String, maxLength: 2048, default: null },
    // Files
    name: { type: String, maxLength: 120, default: "" },
    contentType: { type: String, enum: [...FILE_TYPES, null], default: null },
    size: { type: Number, max: FILE_MAX_BYTES, default: 0 },
    data: { type: Buffer, default: null },
    key: { type: String, default: () => crypto.randomBytes(16).toString("hex") },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "sessionNotes" },
);

sessionNoteSchema.index({ roomId: 1, createdAt: -1 });
sessionNoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// What people in the session see (never the file bytes)
sessionNoteSchema.methods.toView = function toView() {
  const base = { id: this.id, kind: this.kind, createdAt: this.createdAt };
  if (this.kind === "link") return { ...base, url: this.url };
  const file = `/sessionNotes/files/${this.id}?k=${this.key}`;
  return {
    ...base,
    name: this.name,
    size: this.size,
    contentType: this.contentType,
    // Prefixed with the API address by the frontend
    fileUrl: file,
    downloadUrl: `${file}&download=1`,
  };
};

// Is this buffer really the type it claims? (Checks the first bytes, so a
// renamed file or a script can't pass as an image or PDF.)
sessionNoteSchema.statics.matchesType = (buffer, contentType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const ascii = (from, to) => buffer.subarray(from, to).toString("ascii");
  switch (contentType) {
    case "image/jpeg":
      return buffer.subarray(0, 3).toString("hex") === "ffd8ff";
    case "image/png":
      return buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/gif":
      return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "application/pdf":
      return ascii(0, 5) === "%PDF-";
    default:
      return false;
  }
};

sessionNoteSchema.statics.FILE_TYPES = FILE_TYPES;
sessionNoteSchema.statics.FILE_MAX_BYTES = FILE_MAX_BYTES;

module.exports = mongoose.model("SessionNote", sessionNoteSchema);
