// Live Session chat — for everyone in the session (host + invited). Every
// route needs a signed-in user, and sending/reacting needs you to be
// connected to the session's video room right now. Nothing outlives the
// live session: messages are deleted when the call ends or the room empties
// (everyone left or signed out — signaling.js), a message racing the end is
// removed again, and anything left expires with the session (TTL index).
//
//   GET  /sessionChat/:roomId                       → { messages } oldest first
//   POST /sessionChat/:roomId/messages  { body, replyTo? }       → { message }
//   POST /sessionChat/:roomId/messages/:id/reactions  { emoji }  → { message }
//        toggles your reaction: "smile" | "thumbs" | "fire" | "wow"
//
// New messages ("sessionChat:message") and reaction changes
// ("sessionChat:update") are pushed live to everyone in the session.
// "…is typing" goes over the video room's socket instead (signaling.js).

const router = require("express").Router();
const User = require("../models/userModel");
const LiveRoom = require("../models/liveRoomModel");
const Message = require("../models/sessionChatModel");
const { requireAuth } = require("../middleware/requireAuth");
const { sessionChatLimiter } = require("../middleware/rateLimit");
const { chatMessageProblem } = require("../services/chatText");
const { cleanMultiline } = require("../services/links");
const { fullName } = require("../services/memberViews");
const { emitToUser, isInRoom } = require("../services/realtime");

const ROOM_ID_RE = /^[a-z0-9]{8,32}$/i;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const HISTORY_LIMIT = 200;
const QUOTE_MAX = 120;

router.use(requireAuth);

// The active session, if the user is in it; otherwise answers the request
async function sessionFor(req, res) {
  const { roomId } = req.params;
  if (!ROOM_ID_RE.test(roomId || "")) {
    res.status(400).json({ message: "Invalid session." });
    return null;
  }
  const room = await LiveRoom.findActive({ roomId });
  if (!room || !room.canJoin(req.userId)) {
    res.status(404).json({ message: "This session has ended or you're not in it." });
    return null;
  }
  return room;
}

// Messages as the client sees them: author name/photo, a short quote of the
// message being replied to, and who reacted with what (ids — each client
// works out "mine" itself, so one payload can go to everyone).
async function views(messages) {
  if (!messages.length) return [];
  const parentIds = messages.map((m) => m.replyTo).filter(Boolean);
  const parents = new Map(
    (await Message.find({ _id: { $in: parentIds } }).select("author body").lean()).map((p) => [String(p._id), p]),
  );
  const authorIds = new Set(messages.map((m) => String(m.author)));
  parents.forEach((p) => authorIds.add(String(p.author)));
  const authors = new Map(
    (await User.find({ _id: { $in: [...authorIds] } }).select("firstName lastName photoVersion").lean()).map((u) => [
      String(u._id),
      { id: String(u._id), name: fullName(u) || "SkillSwap member", photoV: u.photoVersion || null },
    ]),
  );
  const who = (id) => authors.get(String(id)) || { id: String(id), name: "Former member", photoV: null };

  return messages.map((m) => {
    const parent = m.replyTo ? parents.get(String(m.replyTo)) : null;
    return {
      id: String(m._id),
      author: who(m.author),
      body: m.body,
      createdAt: m.createdAt,
      replyTo: m.replyTo
        ? parent
          ? {
              id: String(parent._id),
              authorName: who(parent.author).name,
              body: parent.body.length > QUOTE_MAX ? `${parent.body.slice(0, QUOTE_MAX)}…` : parent.body,
            }
          : { id: String(m.replyTo), authorName: "", body: "Message no longer available" }
        : null,
      reactions: Object.fromEntries(
        Message.CHAT_REACTIONS.map((key) => [key, (m.reactions?.[key] || []).map(String)]),
      ),
    };
  });
}

// Only people connected to the live session can write in its chat
function requireLive(room, req, res) {
  if (isInRoom(room.roomId, req.userId)) return true;
  res.status(409).json({ message: "Join the live session to chat." });
  return false;
}

// The session ended while this request was in flight (after the check
// above, but possibly after the end-of-session cleanup too). Anything just
// saved would outlive the session, so remove it again.
async function endedSince(room) {
  return !(await LiveRoom.exists({ roomId: room.roomId, endedAt: null }));
}

const pushTo = (room, event, message) =>
  [room.host, ...room.invited].forEach((id) =>
    emitToUser(id, event, { roomId: room.roomId, message }),
  );

router.get("/:roomId", async (req, res) => {
  try {
    const room = await sessionFor(req, res);
    if (!room) return;
    const latest = await Message.find({ roomId: room.roomId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean();
    res.status(200).json({ messages: await views(latest.reverse()) });
  } catch (error) {
    console.error("Load session chat failed:", error);
    res.status(500).json({ message: "Unable to load the chat." });
  }
});

router.post("/:roomId/messages", sessionChatLimiter, async (req, res) => {
  const { body: raw, replyTo } = req.body || {};
  if (typeof raw !== "string") {
    return res.status(400).json({ message: "Write a message first.", field: "body" });
  }
  const body = cleanMultiline(raw);
  // Plain conversation only — no code, links or attacks (services/chatText.js)
  const problem = chatMessageProblem(body);
  if (problem) return res.status(400).json({ message: problem, field: "body" });
  if (replyTo != null && (typeof replyTo !== "string" || !OBJECT_ID_RE.test(replyTo))) {
    return res.status(400).json({ message: "Invalid reply.", field: "replyTo" });
  }

  try {
    const room = await sessionFor(req, res);
    if (!room || !requireLive(room, req, res)) return;
    // Replies only to messages in this same session
    if (replyTo && !(await Message.exists({ _id: replyTo, roomId: room.roomId }))) {
      return res.status(400).json({ message: "That message is no longer available.", field: "replyTo" });
    }
    const doc = await Message.create({
      roomId: room.roomId,
      author: req.userId,
      body,
      replyTo: replyTo || null,
      expiresAt: room.expiresAt,
    });
    if ((await endedSince(room)) || !isInRoom(room.roomId, req.userId)) {
      await Message.deleteOne({ _id: doc._id });
      return res.status(404).json({ message: "This session has ended." });
    }
    const [message] = await views([doc.toObject()]);
    res.status(201).json({ message });
    pushTo(room, "sessionChat:message", message);
  } catch (error) {
    console.error("Send session chat failed:", error);
    res.status(500).json({ message: "Unable to send your message." });
  }
});

router.post("/:roomId/messages/:id/reactions", sessionChatLimiter, async (req, res) => {
  const emoji = req.body?.emoji;
  if (!OBJECT_ID_RE.test(req.params.id || "")) {
    return res.status(400).json({ message: "Invalid message." });
  }
  if (typeof emoji !== "string" || !Message.CHAT_REACTIONS.includes(emoji)) {
    return res.status(400).json({ message: "Unknown reaction.", field: "emoji" });
  }
  try {
    const room = await sessionFor(req, res);
    if (!room || !requireLive(room, req, res)) return;
    const path = `reactions.${emoji}`;
    const match = { _id: req.params.id, roomId: room.roomId };
    // Toggle: take yours away if it's there, otherwise add it
    const doc =
      (await Message.findOneAndUpdate(
        { ...match, [path]: req.userId },
        { $pull: { [path]: req.userId } },
        { returnDocument: "after" },
      ).lean()) ||
      (await Message.findOneAndUpdate(
        match,
        { $addToSet: { [path]: req.userId } },
        { returnDocument: "after" },
      ).lean());
    if (!doc) return res.status(404).json({ message: "That message is no longer available." });
    const [message] = await views([doc]);
    res.status(200).json({ message });
    pushTo(room, "sessionChat:update", message);
  } catch (error) {
    console.error("Session chat reaction failed:", error);
    res.status(500).json({ message: "Unable to react to that message." });
  }
});

module.exports = router;
