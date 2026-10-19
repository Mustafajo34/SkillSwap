// messageBoard — the Messages tab ("The Common Room").
//
//   GET    /messageBoard/images/:id?k=<key>    the image (public, by secret key)
//   — everything below needs a signed-in user —
//   GET    /messageBoard/posts?sort=&q=&limit= → { posts }  newest|discussed|liked
//   GET    /messageBoard/posts/:id             → { post }
//   POST   /messageBoard/posts  { body, links, imageIds } → { post }
//   DELETE /messageBoard/posts/:id             your own post (and its images)
//   POST   /messageBoard/posts/:id/like        → { liked, likeCount }  (toggles)
//   POST   /messageBoard/posts/:id/replies  { body, parentId? } → { reply, replyCount }
//                                              (parentId: answer another reply, any depth)
//   POST   /messageBoard/posts/:id/reactions  { key }  → { reactions }
//   POST   /messageBoard/posts/:id/replies/:replyId/reactions  { key }
//                                              → { reactions }  (toggles; one each)
//   POST   /messageBoard/images   raw image bytes (Content-Type: image/…) → { image }
//   DELETE /messageBoard/images/:id            an upload you haven't posted
//
// Visibility — friends only. You only see, comment on and react to posts by
// yourself and your connects (accepted friend requests). On those posts you
// only see comments (replies) and reactions from yourself and your
// connects: two of the author's connects who aren't connected to each other
// never see — or answer — each other's comments. A comment you can't see
// hides everything answering it too. Anything else is "Post not found".
// Changes are pushed live as "messageBoard:changed" to the people who can
// see the post; each reloads and gets their own view.

const express = require("express");
const User = require("../models/userModel");
const Post = require("../models/messageBoardModel");
const Image = require("../models/messageBoardImageModel");
const { requireAuth } = require("../middleware/requireAuth");
const { boardPostLimiter, boardUploadLimiter } = require("../middleware/rateLimit");
const { safeLink, cleanMultiline } = require("../services/links");
const { fullName } = require("../services/memberViews");
const { emitToUser } = require("../services/realtime");
const { circleOf } = require("../services/friends");
const { stripInvisible, feedTextProblem, feedLinkProblem } = require("../services/contentSafety");

const router = express.Router();
const { POST_MAX, REPLY_MAX, MAX_LINKS, MAX_IMAGES, MAX_REPLIES } = Post.LIMITS;
const REACTION_KEYS = Post.REACTIONS;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const KEY_RE = /^[a-f0-9]{32}$/i;
const MAX_PENDING_UPLOADS = 20;
const MAX_LIST = 50;
const SEARCH_MAX = 50;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Tell the post's audience (its author and the author's connects)
async function changed(type, postId, authorId, extra = {}) {
  try {
    const audience = await circleOf(authorId);
    const payload = { type, postId: String(postId), ...extra };
    audience.forEach((id) => emitToUser(id, "messageBoard:changed", payload));
  } catch (error) {
    console.error("messageBoard live update failed:", error);
  }
}

const NOT_FOUND = { message: "Post not found." };

// ── Public: an image, by id + secret key ─────────────────────────────────────

router.get("/images/:id", async (req, res) => {
  const { id } = req.params;
  const key = req.query.k;
  if (!OBJECT_ID_RE.test(id) || typeof key !== "string" || !KEY_RE.test(key)) {
    return res.sendStatus(404);
  }
  try {
    const image = await Image.findOne({ _id: id, key }).select("contentType data").lean();
    if (!image) return res.sendStatus(404);
    res.set("Cross-Origin-Resource-Policy", "cross-origin"); // <img> on the frontend
    res.set("Cache-Control", "private, max-age=31536000, immutable"); // never changes
    res.set("X-Content-Type-Options", "nosniff");
    res.type(image.contentType).send(Buffer.from(image.data.buffer ?? image.data));
  } catch (error) {
    console.error("messageBoard image failed:", error);
    res.sendStatus(500);
  }
});

router.use(requireAuth);

// ── Views ────────────────────────────────────────────────────────────────────

async function authorsFor(posts) {
  const ids = new Set();
  posts.forEach((p) => {
    ids.add(String(p.author));
    (p.reactions || []).forEach((x) => ids.add(String(x.user)));
    (p.replies || []).forEach((r) => {
      ids.add(String(r.author));
      (r.reactions || []).forEach((x) => ids.add(String(x.user)));
    });
  });
  const users = await User.find({ _id: { $in: [...ids] } })
    .select("firstName lastName userName photoVersion")
    .lean();
  return new Map(
    users.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        name: fullName(u) || u.userName,
        userName: u.userName,
        photoV: u.photoVersion || null,
      },
    ]),
  );
}

const unknownAuthor = (id) => ({
  id: String(id),
  name: "Former member",
  userName: "",
  photoV: null,
});

// Reactions grouped by emoji, in a fixed order: { key, count, mine, names }
function reactionView(list, viewerId, authors, audience) {
  const groups = new Map();
  for (const r of list || []) {
    const user = String(r.user);
    if (!audience.has(user)) continue;
    if (!groups.has(r.key)) groups.set(r.key, { key: r.key, count: 0, mine: false, names: [] });
    const g = groups.get(r.key);
    g.count += 1;
    if (user === String(viewerId)) g.mine = true;
    else if (g.names.length < 10) g.names.push(authors.get(user)?.name || "Former member");
  }
  return REACTION_KEYS.filter((k) => groups.has(k)).map((k) => groups.get(k));
}

// Comments the viewer may see: written by them or one of their connects,
// and not answering a comment they can't see (a hidden comment hides its
// whole thread, so nobody sees answers to a conversation they're not in)
function visibleReplies(replies, circle) {
  const byId = new Map(replies.map((r) => [String(r._id), r]));
  const seen = new Map();
  const visible = (r) => {
    const id = String(r._id);
    if (seen.has(id)) return seen.get(id);
    seen.set(id, false); // guards against a broken parent loop
    let ok = circle.has(String(r.author));
    if (ok && r.parent) {
      const parent = byId.get(String(r.parent));
      ok = Boolean(parent) && visible(parent);
    }
    seen.set(id, ok);
    return ok;
  };
  return replies.filter(visible);
}

// The viewer's view of a post. `circle` = the viewer and their connects:
// whose comments and reactions they see.
function postView(post, viewerId, authors, circle) {
  const replies = visibleReplies(post.replies || [], circle);
  const author = authors.get(String(post.author)) || unknownAuthor(post.author);
  return {
    id: String(post._id),
    author,
    mine: String(post.author) === String(viewerId),
    body: post.body || "",
    images: (post.images || [])
      .filter((img) => img && img.key)
      .map((img) => ({
        id: String(img._id),
        url: `/messageBoard/images/${img._id}?k=${img.key}`,
      })),
    links: post.links || [],
    likeCount: post.likeCount || 0,
    liked: (post.likes || []).some((id) => String(id) === String(viewerId)),
    reactions: reactionView(post.reactions, viewerId, authors, circle),
    replyCount: replies.length,
    replies: replies.map((r) => ({
      id: String(r._id),
      author: authors.get(String(r.author)) || unknownAuthor(r.author),
      mine: String(r.author) === String(viewerId),
      body: r.body,
      parentId: r.parent ? String(r.parent) : null,
      reactions: reactionView(r.reactions, viewerId, authors, circle),
      createdAt: r.createdAt,
    })),
    createdAt: post.createdAt,
  };
}

async function viewsFor(posts, viewerId, viewerCircle) {
  const [authors, circle] = await Promise.all([
    authorsFor(posts),
    viewerCircle || circleOf(viewerId),
  ]);
  return posts.map((p) => postView(p, viewerId, authors, circle));
}

// The post if the viewer may see it (author is them or a connect), else null
async function visiblePost(postId, viewerId) {
  const circle = await circleOf(viewerId);
  const post = await Post.findOne({ _id: postId, author: { $in: [...circle] } }).select("author").lean();
  return post ? { post, circle } : null;
}

// Checks free text for a post/reply; returns [cleanText, errorMessage].
// Invisible characters are removed first; then script / injection,
// harmful symbols, secrets, credential requests and unsafe links are
// refused (services/contentSafety.js).
function checkText(raw, max, label) {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return [null, `${label} must be text.`];
  }
  const text = cleanMultiline(stripInvisible(raw));
  if (text.length > max) return [null, `${label} must be ${max} characters or fewer.`];
  const problem = feedTextProblem(text);
  if (problem) return [null, problem];
  return [text, ""];
}

const loadPost = (id) =>
  Post.findById(id).populate("images", "key").lean();

// ── Posts ────────────────────────────────────────────────────────────────────

router.get("/posts", async (req, res) => {
  const sort = req.query.sort === undefined ? "newest" : req.query.sort;
  const order = {
    newest: { createdAt: -1 },
    discussed: { replyCount: -1, createdAt: -1 },
    liked: { likeCount: -1, createdAt: -1 },
  }[sort];
  if (!order) return res.status(400).json({ message: "Unknown sort.", field: "sort" });

  let q = req.query.q;
  if (q !== undefined) {
    if (typeof q !== "string") return res.status(400).json({ message: "Search must be text.", field: "q" });
    q = stripInvisible(q).trim();
    if (q.length > SEARCH_MAX) {
      return res.status(400).json({ message: `Search must be ${SEARCH_MAX} characters or fewer.`, field: "q" });
    }
    const searchProblem = feedTextProblem(q);
    if (searchProblem) return res.status(400).json({ message: searchProblem, field: "q" });
  }
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || MAX_LIST, 1), MAX_LIST);

  try {
    const circle = await circleOf(req.userId);
    const filter = { author: { $in: [...circle] } };
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      // Text, links, or the author's name / username
      const people = await User.find({
        $or: [{ firstName: re }, { lastName: re }, { userName: re }],
      })
        .select("_id")
        .limit(200)
        .lean();
      filter.$or = [{ body: re }, { links: re }, { author: { $in: people.map((u) => u._id) } }];
      // (the $or narrows within your circle — the author filter above still applies)
    }
    const posts = await Post.find(filter).sort(order).limit(limit).populate("images", "key").lean();
    res.status(200).json({ posts: await viewsFor(posts, req.userId, circle) });
  } catch (error) {
    console.error("messageBoard list failed:", error);
    res.status(500).json({ message: "Unable to load posts." });
  }
});

router.get("/posts/:id", async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: "Post not found." });
  try {
    const access = await visiblePost(req.params.id, req.userId);
    if (!access) return res.status(404).json(NOT_FOUND);
    const post = await loadPost(req.params.id);
    if (!post) return res.status(404).json(NOT_FOUND);
    const [view] = await viewsFor([post], req.userId, access.circle);
    res.status(200).json({ post: view });
  } catch (error) {
    console.error("messageBoard get failed:", error);
    res.status(500).json({ message: "Unable to load the post." });
  }
});

router.post("/posts", boardPostLimiter, async (req, res) => {
  const { body: rawBody, links: rawLinks = [], imageIds = [] } = req.body || {};

  const [body, bodyError] = checkText(rawBody, POST_MAX, "Post");
  if (bodyError) return res.status(400).json({ message: bodyError, field: "body" });

  if (!Array.isArray(rawLinks) || rawLinks.length > MAX_LINKS) {
    return res.status(400).json({ message: `Add up to ${MAX_LINKS} links.`, field: "links" });
  }
  const links = [];
  for (const raw of rawLinks) {
    const href = typeof raw === "string" ? safeLink(raw) : null;
    if (!href) {
      return res.status(400).json({
        message: "Links must be web addresses starting with http:// or https://.",
        field: "links",
      });
    }
    const linkProblem = feedLinkProblem(href);
    if (linkProblem) return res.status(400).json({ message: linkProblem, field: "links" });
    if (!links.includes(href)) links.push(href);
  }

  if (
    !Array.isArray(imageIds) ||
    imageIds.length > MAX_IMAGES ||
    !imageIds.every((id) => typeof id === "string" && OBJECT_ID_RE.test(id))
  ) {
    return res.status(400).json({ message: `Add up to ${MAX_IMAGES} images.`, field: "imageIds" });
  }
  const uniqueImageIds = [...new Set(imageIds)];

  if (!body && links.length === 0 && uniqueImageIds.length === 0) {
    return res.status(400).json({ message: "Write something, or add an image or link.", field: "body" });
  }

  try {
    // Only your own uploads that aren't already on a post
    const images = await Image.find({ _id: { $in: uniqueImageIds }, owner: req.userId, post: null })
      .select("_id")
      .lean();
    if (images.length !== uniqueImageIds.length) {
      return res.status(400).json({
        message: "One of your images has expired. Please add it again.",
        field: "imageIds",
      });
    }

    const post = await Post.create({ author: req.userId, body, links, images: uniqueImageIds });
    await Image.updateMany(
      { _id: { $in: uniqueImageIds } },
      { $set: { post: post._id, expiresAt: null } },
    );

    const [view] = await viewsFor([await loadPost(post._id)], req.userId);
    res.status(201).json({ post: view });
    changed("post", post._id, req.userId);
  } catch (error) {
    console.error("messageBoard post failed:", error);
    res.status(500).json({ message: "Unable to publish your post." });
  }
});

router.delete("/posts/:id", async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: "Post not found." });
  try {
    const post = await Post.findOneAndDelete({ _id: req.params.id, author: req.userId });
    if (!post) {
      return res.status(404).json({ message: "Post not found, or it isn't yours to delete." });
    }
    await Image.deleteMany({ post: post._id });
    res.status(200).json({ deleted: true });
    changed("delete", post._id, req.userId);
  } catch (error) {
    console.error("messageBoard delete failed:", error);
    res.status(500).json({ message: "Unable to delete the post." });
  }
});

router.post("/posts/:id/like", async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: "Post not found." });
  try {
    const access = await visiblePost(req.params.id, req.userId);
    if (!access) return res.status(404).json(NOT_FOUND);
    // Atomic toggle: unlike if you'd liked it, otherwise like
    let post = await Post.findOneAndUpdate(
      { _id: req.params.id, likes: req.userId },
      { $pull: { likes: req.userId }, $inc: { likeCount: -1 } },
      { returnDocument: "after" },
    ).select("likeCount");
    let liked = false;
    if (!post) {
      post = await Post.findOneAndUpdate(
        { _id: req.params.id, likes: { $ne: req.userId } },
        { $addToSet: { likes: req.userId }, $inc: { likeCount: 1 } },
        { returnDocument: "after" },
      ).select("likeCount");
      liked = true;
    }
    if (!post) return res.status(404).json({ message: "Post not found." });
    res.status(200).json({ liked, likeCount: post.likeCount });
    changed("like", post._id, access.post.author, { likeCount: post.likeCount });
  } catch (error) {
    console.error("messageBoard like failed:", error);
    res.status(500).json({ message: "Unable to update the like." });
  }
});

router.post("/posts/:id/replies", boardPostLimiter, async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: "Post not found." });
  const [body, error] = checkText(req.body?.body, REPLY_MAX, "Reply");
  if (error) return res.status(400).json({ message: error, field: "body" });
  if (!body) return res.status(400).json({ message: "Write a reply first.", field: "body" });
  const parentId = req.body?.parentId ?? null;
  if (parentId !== null && (typeof parentId !== "string" || !OBJECT_ID_RE.test(parentId))) {
    return res.status(400).json({ message: "Invalid reply.", field: "parentId" });
  }
  try {
    const access = await visiblePost(req.params.id, req.userId);
    if (!access) return res.status(404).json(NOT_FOUND);
    // Answering a comment: only one you can see (yours or a connect's)
    if (parentId) {
      const found = await Post.findById(req.params.id)
        .select("replies._id replies.author replies.parent")
        .lean();
      const visible = visibleReplies(found?.replies || [], access.circle);
      if (!visible.some((r) => String(r._id) === parentId)) {
        return res.status(404).json({ message: "That reply is no longer there.", field: "parentId" });
      }
    }
    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, replyCount: { $lt: MAX_REPLIES } },
      { $push: { replies: { author: req.userId, body, parent: parentId } }, $inc: { replyCount: 1 } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!post) {
      const exists = await Post.exists({ _id: req.params.id });
      return exists
        ? res.status(400).json({ message: "This post has reached its reply limit." })
        : res.status(404).json({ message: "Post not found." });
    }
    const reply = post.replies[post.replies.length - 1];
    const authors = await authorsFor([{ author: req.userId, replies: [] }]);
    res.status(201).json({
      reply: {
        id: String(reply._id),
        author: authors.get(String(req.userId)) || unknownAuthor(req.userId),
        mine: true,
        body: reply.body,
        parentId: reply.parent ? String(reply.parent) : null,
        reactions: [],
        createdAt: reply.createdAt,
      },
      // Comments you can see (yours and your connects')
      replyCount: visibleReplies(post.replies, access.circle).length,
    });
    changed("reply", post._id, post.author);
  } catch (err) {
    console.error("messageBoard reply failed:", err);
    res.status(500).json({ message: "Unable to post your reply." });
  }
});

// ── Emoji reactions ──────────────────────────────────────────────────────────

// Your reaction on a post or one of its replies. Same emoji again → removed;
// a different one → swapped. Atomic per step: pull yours (seeing what it
// was), then add the new one only if you still have none — so double
// clicks can't leave two.
async function react(req, res, replyId) {
  const key = req.body?.key;
  if (!REACTION_KEYS.includes(key)) {
    return res.status(400).json({ message: "Unknown reaction.", field: "key" });
  }
  const { id } = req.params;
  if (!OBJECT_ID_RE.test(id) || (replyId !== undefined && !OBJECT_ID_RE.test(replyId))) {
    return res.status(404).json(NOT_FOUND);
  }
  try {
    const access = await visiblePost(id, req.userId);
    if (!access) return res.status(404).json(NOT_FOUND);
    const me = req.userId;
    const audience = access.circle; // you + your connects
    // Reacting to a comment: only one you can see
    if (replyId !== undefined) {
      const found = await Post.findById(id).select("replies._id replies.author replies.parent").lean();
      if (!visibleReplies(found?.replies || [], audience).some((r) => String(r._id) === replyId)) {
        return res.status(404).json({ message: "Reply not found." });
      }
    }

    let before;
    if (replyId === undefined) {
      before = await Post.findOneAndUpdate(
        { _id: id },
        { $pull: { reactions: { user: me } } },
        { returnDocument: "before" },
      )
        .select("reactions")
        .lean();
    } else {
      before = await Post.findOneAndUpdate(
        { _id: id, "replies._id": replyId },
        { $pull: { "replies.$[r].reactions": { user: me } } },
        { returnDocument: "before", arrayFilters: [{ "r._id": replyId }] },
      )
        .select("replies._id replies.author replies.reactions")
        .lean();
    }
    if (!before) {
      return res.status(404).json({ message: replyId ? "Reply not found." : "Post not found." });
    }
    const target =
      replyId === undefined ? before : before.replies.find((r) => String(r._id) === replyId);
    const previous = (target.reactions || []).find((x) => String(x.user) === String(me));

    if (previous?.key !== key) {
      if (replyId === undefined) {
        await Post.updateOne(
          { _id: id, "reactions.user": { $ne: me } },
          { $push: { reactions: { user: me, key } } },
        );
      } else {
        await Post.updateOne(
          { _id: id, replies: { $elemMatch: { _id: replyId, "reactions.user": { $ne: me } } } },
          { $push: { "replies.$.reactions": { user: me, key } } },
        );
      }
    }

    const post = await Post.findById(id).select("author reactions replies").lean();
    const target2 =
      replyId === undefined ? post : post?.replies.find((r) => String(r._id) === replyId);
    const authors = await authorsFor([{ author: post.author, reactions: target2?.reactions || [] }]);
    res.status(200).json({
      reactions: reactionView(target2?.reactions, me, authors, audience),
    });
    changed("react", id, access.post.author, { replyId: replyId || null });
  } catch (error) {
    console.error("messageBoard reaction failed:", error);
    res.status(500).json({ message: "Unable to save your reaction." });
  }
}

router.post("/posts/:id/reactions", (req, res) => react(req, res));
router.post("/posts/:id/replies/:replyId/reactions", (req, res) =>
  react(req, res, req.params.replyId),
);

// ── Image uploads (raw bytes, not JSON) ──────────────────────────────────────

router.post(
  "/images",
  boardUploadLimiter,
  express.raw({ type: Image.IMAGE_TYPES, limit: Image.IMAGE_MAX_BYTES }),
  async (req, res) => {
    const contentType = String(req.get("content-type") || "").split(";")[0].trim();
    if (!Image.IMAGE_TYPES.includes(contentType) || !Buffer.isBuffer(req.body)) {
      return res.status(415).json({ message: "Only JPG, PNG, WEBP or GIF images can be uploaded." });
    }
    if (!Image.matchesType(req.body, contentType)) {
      return res.status(400).json({ message: "That file isn't a real image of the type it claims." });
    }
    try {
      const pending = await Image.countDocuments({ owner: req.userId, post: null });
      if (pending >= MAX_PENDING_UPLOADS) {
        return res.status(429).json({ message: "Post or remove your waiting images before adding more." });
      }
      const image = await Image.create({
        owner: req.userId,
        contentType,
        data: req.body,
        size: req.body.length,
      });
      res.status(201).json({ image: { id: image.id, url: image.urlPath() } });
    } catch (error) {
      console.error("messageBoard upload failed:", error);
      res.status(500).json({ message: "Unable to upload the image." });
    }
  },
);

router.delete("/images/:id", async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: "Image not found." });
  try {
    const { deletedCount } = await Image.deleteOne({ _id: req.params.id, owner: req.userId, post: null });
    if (!deletedCount) return res.status(404).json({ message: "Image not found." });
    res.status(200).json({ deleted: true });
  } catch (error) {
    console.error("messageBoard image delete failed:", error);
    res.status(500).json({ message: "Unable to remove the image." });
  }
});

// Too-large uploads (from express.raw) → a JSON message the app can show
router.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "That image is too large (2.5 MB max after resizing)." });
  }
  next(err);
});

module.exports = router;
