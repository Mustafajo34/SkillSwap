const mongoose = require("mongoose");

// messageBoard — posts on the Messages tab ("The Common Room"), saved in the
// "messageBoard" collection. Images live in their own collection
// (messageBoardImageModel.js); a post only keeps references to them.

const POST_MAX = 500;
const REPLY_MAX = 300;
const MAX_LINKS = 3;
const MAX_IMAGES = 4;
const MAX_REPLIES = 200;
// Emoji reactions (keys only — the emoji live in the frontend's
// components/Messages.jsx). One per person per post or reply: picking
// another swaps it, picking the same one again takes it back.
const REACTIONS = ["thumbs", "heart", "joy", "party", "wow", "fire"];

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, enum: REACTIONS, required: true },
  },
  { _id: false },
);

const replySchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, maxLength: REPLY_MAX },
    // The reply this answers (another reply on the same post); null = a
    // reply to the post itself. Threads can go any depth.
    parent: { type: mongoose.Schema.Types.ObjectId, default: null },
    reactions: { type: [reactionSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "", maxLength: POST_MAX },
    images: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "MessageBoardImage" }],
      validate: [(list) => list.length <= MAX_IMAGES, `Up to ${MAX_IMAGES} images`],
    },
    links: {
      type: [String],
      validate: [(list) => list.length <= MAX_LINKS, `Up to ${MAX_LINKS} links`],
    },
    // Who liked it, plus a count kept in step (for "Most liked" sorting)
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likeCount: { type: Number, default: 0, min: 0 },
    replies: {
      type: [replySchema],
      validate: [(list) => list.length <= MAX_REPLIES, `Up to ${MAX_REPLIES} replies`],
    },
    replyCount: { type: Number, default: 0, min: 0 }, // "Most discussed"
    reactions: { type: [reactionSchema], default: [] },
  },
  { timestamps: true, collection: "messageBoard" },
);

postSchema.index({ createdAt: -1 });
postSchema.index({ likeCount: -1, createdAt: -1 });
postSchema.index({ replyCount: -1, createdAt: -1 });

postSchema.statics.LIMITS = { POST_MAX, REPLY_MAX, MAX_LINKS, MAX_IMAGES, MAX_REPLIES };
postSchema.statics.REACTIONS = REACTIONS;

module.exports = mongoose.model("MessageBoardPost", postSchema);
