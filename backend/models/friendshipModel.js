const mongoose = require("mongoose");

// A friend request between two users, and — once accepted — their
// friendship. There is exactly one document per pair of users, whichever of
// them asked first: `pair` (the two ids, sorted) is unique, so two people
// sending each other a request at the same moment can't create two rows.
const friendshipSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    pair: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "accepted"],
      default: "pending",
      required: true,
    },
    acceptedAt: { type: Date, default: null },
    // The skill swap proposal that sent this request, if any — declining or
    // withdrawing that swap withdraws the request too
    swap: { type: mongoose.Schema.Types.ObjectId, ref: "SwapRequest", default: null },
  },
  { timestamps: true },
);

// "Who are my friends / requests?" from either side
friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ recipient: 1, status: 1 });

friendshipSchema.statics.pairKey = (a, b) =>
  [String(a), String(b)].sort().join(":");

// The other person in a friendship, as a string id
friendshipSchema.statics.otherId = (link, userId) =>
  String(link.requester) === String(userId)
    ? String(link.recipient)
    : String(link.requester);

module.exports = mongoose.model("Friendship", friendshipSchema);
