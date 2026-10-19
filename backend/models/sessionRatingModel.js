const mongoose = require("mongoose");

// One person's rating of another after a Live Session they were both in.
// Each person rates each other attendee once per session (they can change
// it until the session expires). The stars also count towards the rated
// member's overall rating (User.ratingSum / ratingCount), the same total
// that skill swap reviews add to — see routes/sessionRoute.js.

// Quick compliments shown as chips under the stars
const RATING_TAGS = [
  "Great teacher",
  "Clear explanations",
  "Patient",
  "Friendly",
  "Well prepared",
  "On time",
];
const COMMENT_MAX = 280;

const sessionRatingSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    tags: { type: [{ type: String, enum: RATING_TAGS }], default: [] },
    comment: { type: String, maxLength: COMMENT_MAX, default: "" },
  },
  { timestamps: true, collection: "sessionRatings" },
);

sessionRatingSchema.index({ roomId: 1, from: 1, to: 1 }, { unique: true });
// "Ratings you've received", newest first
sessionRatingSchema.index({ to: 1, createdAt: -1 });

sessionRatingSchema.statics.RATING_TAGS = RATING_TAGS;
sessionRatingSchema.statics.COMMENT_MAX = COMMENT_MAX;

module.exports = mongoose.model("SessionRating", sessionRatingSchema);
