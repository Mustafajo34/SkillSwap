const mongoose = require("mongoose");
const { SKILLS } = require("../data/skills");

// A skill swap between two members: `from` offers to teach one of their
// skills (`offer`) in exchange for learning one of `to`'s skills (`want`).
//
//   pending ──accept──▶ accepted ──complete──▶ completed (+1 swap each,
//      │                   │                    then each can rate the other)
//      ├─decline─▶ declined └─cancel─▶ cancelled
//      └─cancel──▶ cancelled
//
// Two people can only have one open (pending or accepted) swap at a time:
// `open` + `pair` is unique while open, so double-clicks or both people
// asking at the same moment can't create two.

const STATUSES = ["pending", "accepted", "declined", "cancelled", "completed"];
const OPEN_STATUSES = ["pending", "accepted"];

const swapRequestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pair: { type: String, required: true },
    offer: { type: String, enum: SKILLS, required: true },
    want: { type: String, enum: SKILLS, required: true },
    message: { type: String, maxLength: 300, default: "" },
    status: { type: String, enum: STATUSES, default: "pending", required: true },
    open: { type: Boolean, default: true },
    // Who ended it (cancel / complete) — for "Maya cancelled" wording
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    respondedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // 1–5 stars each person gave the other after completing
    fromRating: { type: Number, min: 1, max: 5, default: null },
    toRating: { type: Number, min: 1, max: 5, default: null },
  },
  { timestamps: true, collection: "swapRequests" },
);

swapRequestSchema.index(
  { pair: 1 },
  { unique: true, partialFilterExpression: { open: true }, name: "one_open_swap_per_pair" },
);
// "My swaps", newest first, from either side
swapRequestSchema.index({ from: 1, updatedAt: -1 });
swapRequestSchema.index({ to: 1, updatedAt: -1 });

swapRequestSchema.statics.pairKey = (a, b) => [String(a), String(b)].sort().join(":");
swapRequestSchema.statics.STATUSES = STATUSES;
swapRequestSchema.statics.OPEN_STATUSES = OPEN_STATUSES;

module.exports = mongoose.model("SwapRequest", swapRequestSchema);
