// Live Sessions (invite-only video rooms). Every route needs a signed-in
// user (Authorization: Bearer <access token>).
//
//   POST /sessions                     → { session } — start one; you're the host
//   GET  /sessions/:roomId             → { session } — host or invited only
//   POST /sessions/join  { code }      → { session } — use an invite link's code
//   POST /sessions/:roomId/invites  { userIds }
//                                      → { invited } — host invites people by
//                                        id; each gets a live notification
//   POST /sessions/:roomId/respond  { response: "accept" | "decline" }
//                                      → { response } — an invitee answers;
//                                        the host is notified
//   GET  /sessions/:roomId/ratings     → { open, closesAt, tags, commentMax, people }
//                                        — the others you were in the call
//                                        with, your rating of each, and
//                                        whether they've rated you
//   POST /sessions/:roomId/ratings  { userId, rating, tags?, comment? }
//                                      → { rating } — rate someone you were
//                                        in an ended call with (1–5 stars;
//                                        changeable until the session expires)
//
// Notifications (services/notifications.js) are saved and pushed live.
//
// The signaling server (signaling.js) checks the same host/invited list
// before letting a socket into the room.

const router = require("express").Router();
const User = require("../models/userModel");
const LiveRoom = require("../models/liveRoomModel");
const { requireAuth } = require("../middleware/requireAuth");
const { sessionLimiter } = require("../middleware/rateLimit");
const { fullName } = require("../services/memberViews");
const { notify, actorFor } = require("../services/notifications");
const Notification = require("../models/notificationModel");
const SessionRating = require("../models/sessionRatingModel");
const { cleanMultiline } = require("../services/links");
const { stripInvisible, textSafetyProblem } = require("../services/contentSafety");
const { emitToUser } = require("../services/realtime");
const { broadcastStats } = require("../services/profileEvents");

const ROOM_ID_RE = /^[a-z0-9]{8,32}$/i;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
// Matches signaling.js's room size: host + 5
const MAX_INVITES_PER_REQUEST = 5;

router.use(requireAuth);

// What a member of the session sees. Only the host gets the invite code —
// the session is invite-only, so only the host can hand out the link.
async function sessionView(room, userId) {
  const host = await User.findById(room.host).select("firstName lastName").lean();
  const isHost = room.isHost(userId);
  return {
    roomId: room.roomId,
    isHost,
    host: { id: String(room.host), name: fullName(host || {}) || "SkillSwap member" },
    invitedCount: room.invited.length,
    expiresAt: room.expiresAt,
    ...(isHost && { inviteCode: room.inviteCode }),
  };
}

router.post("/", sessionLimiter, async (req, res) => {
  try {
    const room = await LiveRoom.createFor(req.userId);
    res.status(201).json({ session: await sessionView(room, req.userId) });
  } catch (error) {
    console.error("Create session failed:", error);
    res.status(500).json({ message: "Unable to start a session." });
  }
});

router.post("/join", sessionLimiter, async (req, res) => {
  const code = req.body?.code;
  if (typeof code !== "string" || !LiveRoom.INVITE_CODE_RE.test(code)) {
    return res
      .status(400)
      .json({ message: "That isn't a valid SkillSwap invite link.", field: "code" });
  }
  try {
    const room = await LiveRoom.findActive({ inviteCode: code });
    if (!room) {
      return res
        .status(404)
        .json({ message: "This invite link has expired or the session has ended." });
    }
    const isNew = !room.canJoin(req.userId);
    if (isNew) {
      room.invited.addToSet(req.userId);
      await room.save();
    }
    res.status(200).json({ session: await sessionView(room, req.userId) });
    // Let the host know someone is coming in through their link
    if (isNew) {
      notify(room.host, "session_link_join", await actorFor(req.userId), {
        roomId: room.roomId,
      });
    }
  } catch (error) {
    console.error("Join session failed:", error);
    res.status(500).json({ message: "Unable to join the session." });
  }
});

router.get("/:roomId", async (req, res) => {
  const { roomId } = req.params;
  if (!ROOM_ID_RE.test(roomId)) {
    return res.status(404).json({ message: "This session doesn't exist." });
  }
  try {
    const room = await LiveRoom.findActive({ roomId });
    if (!room) {
      return res
        .status(404)
        .json({ message: "This session has ended or doesn't exist." });
    }
    if (!room.canJoin(req.userId)) {
      return res.status(403).json({
        message: "This session is invite-only. Ask the host for an invite link.",
      });
    }
    res.status(200).json({ session: await sessionView(room, req.userId) });
  } catch (error) {
    console.error("Get session failed:", error);
    res.status(500).json({ message: "Unable to load the session." });
  }
});

router.post("/:roomId/invites", sessionLimiter, async (req, res) => {
  const { roomId } = req.params;
  const userIds = req.body?.userIds;
  if (
    !Array.isArray(userIds) ||
    userIds.length === 0 ||
    userIds.length > MAX_INVITES_PER_REQUEST ||
    !userIds.every((id) => typeof id === "string" && OBJECT_ID_RE.test(id))
  ) {
    return res.status(400).json({
      message: `Choose between 1 and ${MAX_INVITES_PER_REQUEST} people to invite.`,
      field: "userIds",
    });
  }
  const ids = [...new Set(userIds)].filter((id) => id !== String(req.userId));
  if (ids.length === 0) {
    return res.status(400).json({ message: "You can't invite yourself.", field: "userIds" });
  }

  try {
    const room = ROOM_ID_RE.test(roomId) && (await LiveRoom.findActive({ roomId }));
    if (!room) {
      return res.status(404).json({ message: "This session has ended." });
    }
    if (!room.isHost(req.userId)) {
      return res.status(403).json({ message: "Only the host can invite people." });
    }

    const found = await User.find({ _id: { $in: ids } }).select("_id").lean();
    if (found.length !== ids.length) {
      return res.status(404).json({ message: "Some of those members don't exist." });
    }

    ids.forEach((id) => room.invited.addToSet(id));
    await room.save();

    // Saved + pushed live: the invitee's app rings ("wants to video chat")
    const actor = await actorFor(req.userId);
    await Promise.all(
      ids.map((id) =>
        notify(id, "session_invite", actor, {
          roomId: room.roomId,
          sessionExpiresAt: room.expiresAt,
        }),
      ),
    );

    res.status(200).json({ invited: ids.length });
  } catch (error) {
    console.error("Invite to session failed:", error);
    res.status(500).json({ message: "Unable to send invites." });
  }
});

router.post("/:roomId/respond", sessionLimiter, async (req, res) => {
  const { roomId } = req.params;
  const response = req.body?.response;
  if (response !== "accept" && response !== "decline") {
    return res
      .status(400)
      .json({ message: "Response must be accept or decline.", field: "response" });
  }
  try {
    const room = ROOM_ID_RE.test(roomId) && (await LiveRoom.findActive({ roomId }));
    if (!room) {
      return res.status(404).json({ message: "This session has ended." });
    }
    if (room.isHost(req.userId) || !room.canJoin(req.userId)) {
      return res.status(403).json({ message: "You weren't invited to this session." });
    }

    // Their invite has been dealt with
    await Notification.updateMany(
      {
        user: req.userId,
        type: "session_invite",
        "data.roomId": room.roomId,
        read: false,
      },
      { read: true },
    );
    res.status(200).json({ response });
    notify(room.host, "session_response", await actorFor(req.userId), {
      roomId: room.roomId,
      response,
    });
  } catch (error) {
    console.error("Respond to session invite failed:", error);
    res.status(500).json({ message: "Unable to answer the invite." });
  }
});

// ── Ratings (after the call) ─────────────────────────────────────────────────

// The session for rating: still stored (not expired), and you were in the
// call. Answers the request itself when it isn't; returns null then.
async function ratableRoom(req, res) {
  const { roomId } = req.params;
  const room =
    ROOM_ID_RE.test(roomId) &&
    (await LiveRoom.findOne({ roomId, expiresAt: { $gt: new Date() } }));
  if (!room) {
    res.status(404).json({ message: "This session can't be rated any more." });
    return null;
  }
  if (!(room.attendees || []).some((id) => String(id) === String(req.userId))) {
    res.status(403).json({ message: "Only people who were in the call can rate it." });
    return null;
  }
  return room;
}

const otherAttendees = (room, userId) =>
  (room.attendees || []).map(String).filter((id) => id !== String(userId));

router.get("/:roomId/ratings", async (req, res) => {
  try {
    const room = await ratableRoom(req, res);
    if (!room) return;
    const others = otherAttendees(room, req.userId);
    const [users, given, received] = await Promise.all([
      User.find({ _id: { $in: others } }).select("firstName lastName photoVersion").lean(),
      SessionRating.find({ roomId: room.roomId, from: req.userId }).lean(),
      SessionRating.find({ roomId: room.roomId, to: req.userId }).select("from").lean(),
    ]);
    const mine = new Map(given.map((r) => [String(r.to), r]));
    const ratedMe = new Set(received.map((r) => String(r.from)));
    res.status(200).json({
      open: Boolean(room.endedAt),
      closesAt: room.expiresAt,
      tags: SessionRating.RATING_TAGS,
      commentMax: SessionRating.COMMENT_MAX,
      people: users.map((u) => {
        const id = String(u._id);
        const r = mine.get(id);
        return {
          id,
          name: fullName(u) || "SkillSwap member",
          photoV: u.photoVersion || null,
          yours: r ? { rating: r.rating, tags: r.tags, comment: r.comment } : null,
          ratedYou: ratedMe.has(id),
        };
      }),
    });
  } catch (error) {
    console.error("Load session ratings failed:", error);
    res.status(500).json({ message: "Unable to load ratings." });
  }
});

router.post("/:roomId/ratings", sessionLimiter, async (req, res) => {
  const { userId, rating, tags = [], comment: rawComment = "" } = req.body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Choose 1 to 5 stars.", field: "rating" });
  }
  if (
    !Array.isArray(tags) ||
    tags.length > SessionRating.RATING_TAGS.length ||
    !tags.every((t) => SessionRating.RATING_TAGS.includes(t))
  ) {
    return res.status(400).json({ message: "Unknown compliment.", field: "tags" });
  }
  if (typeof rawComment !== "string") {
    return res.status(400).json({ message: "Comment must be text.", field: "comment" });
  }
  const comment = cleanMultiline(stripInvisible(rawComment));
  if (comment.length > SessionRating.COMMENT_MAX) {
    return res.status(400).json({
      message: `Comment must be ${SessionRating.COMMENT_MAX} characters or fewer.`,
      field: "comment",
    });
  }
  const commentProblem = textSafetyProblem(comment);
  if (commentProblem) return res.status(400).json({ message: commentProblem, field: "comment" });

  try {
    const room = await ratableRoom(req, res);
    if (!room) return;
    if (!room.endedAt) {
      return res.status(409).json({ message: "You can rate once the call has ended." });
    }
    if (typeof userId !== "string" || !otherAttendees(room, req.userId).includes(userId)) {
      return res
        .status(400)
        .json({ message: "You can only rate people who were in the call with you.", field: "userId" });
    }

    // Save yours (new or changed) and get the one it replaced, if any. Two
    // first-time saves at once: one hits the unique index — retry, it's an
    // update by then.
    const filter = { roomId: room.roomId, from: req.userId, to: userId };
    const update = { $set: { rating, tags: [...new Set(tags)], comment } };
    let previous;
    for (let attempt = 0; ; attempt++) {
      try {
        previous = await SessionRating.findOneAndUpdate(filter, update, {
          upsert: true,
          returnDocument: "before",
          runValidators: true,
        }).lean();
        break;
      } catch (error) {
        if (error.code !== 11000 || attempt > 0) throw error;
      }
    }

    // Their overall rating (shared with swap reviews): a new rating adds a
    // review; a changed one only moves the total
    const inc = previous
      ? { ratingSum: rating - previous.rating }
      : { ratingSum: rating, ratingCount: 1 };
    if (inc.ratingSum || inc.ratingCount) {
      await User.updateOne({ _id: userId }, { $inc: inc });
      broadcastStats(userId);
    }

    res.status(previous ? 200 : 201).json({
      rating: { userId, rating, tags: update.$set.tags, comment },
    });

    // Their ended-session screen shows "rated you" live; the first rating
    // also lands in their bell
    emitToUser(userId, "session:rated", { roomId: room.roomId, by: String(req.userId) });
    if (!previous) {
      notify(userId, "session_rating", await actorFor(req.userId), {
        roomId: room.roomId,
        rating,
      });
    }
  } catch (error) {
    console.error("Rate session failed:", error);
    res.status(500).json({ message: "Unable to save your rating." });
  }
});

module.exports = router;
