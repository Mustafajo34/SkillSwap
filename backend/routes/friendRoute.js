// Friends and friend requests. Every route needs a signed-in user
// (Authorization: Bearer <access token>). Responses that change a
// relationship return the new status as the viewer sees it:
// "none" | "requested" | "incoming" | "friends".
//
//   GET    /friends                           → { friends, incoming, outgoing }
//   POST   /friends/requests  { userId }      → send (or accept, if they asked you)
//   DELETE /friends/requests/:userId          → cancel a request you sent
//   POST   /friends/requests/:userId/accept   → accept their request
//   POST   /friends/requests/:userId/decline  → decline their request
//   DELETE /friends/:userId                   → unfriend

const router = require("express").Router();
const User = require("../models/userModel");
const Friendship = require("../models/friendshipModel");
const { requireAuth } = require("../middleware/requireAuth");
const { friendRequestLimiter } = require("../middleware/rateLimit");
const { buildMemberViews, MEMBER_FIELDS } = require("../services/memberViews");
const { emitToUser } = require("../services/realtime");
const { notify, actorFor } = require("../services/notifications");

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

router.use(requireAuth);

// Live update for both people after a change, so every open tab refreshes.
// The other person also learns who did it (for "Maya accepted…" toasts).
// type: "request" | "accept" | "decline" | "cancel" | "remove"
// Requests and accepts also become saved notifications (the navbar bell).
async function notifyChange(req, otherId, type) {
  try {
    const by = await actorFor(req.userId);
    emitToUser(otherId, "connects:changed", { type, by });
    emitToUser(req.userId, "connects:changed", { type, self: true, userId: otherId });
    if (type === "request") await notify(otherId, "connect_request", by);
    if (type === "accept") await notify(otherId, "connect_accept", by);
  } catch (error) {
    console.error("Live update failed:", error);
  }
}

// Validates :userId / body.userId; answers the request itself when invalid
function targetId(req, res, value) {
  if (typeof value !== "string" || !OBJECT_ID_RE.test(value)) {
    res.status(400).json({ message: "Invalid user id.", field: "userId" });
    return null;
  }
  if (value === String(req.userId)) {
    res.status(400).json({ message: "You can't add yourself as a friend." });
    return null;
  }
  return value;
}

router.get("/", async (req, res) => {
  try {
    const links = await Friendship.find({
      $or: [{ requester: req.userId }, { recipient: req.userId }],
    }).lean();
    const otherIds = links.map((link) => Friendship.otherId(link, req.userId));
    const users = await User.find({ _id: { $in: otherIds } })
      .select(MEMBER_FIELDS)
      .lean();
    const views = await buildMemberViews(req.userId, users);

    res.status(200).json({
      friends: views.filter((m) => m.friendship === "friends"),
      incoming: views.filter((m) => m.friendship === "incoming"),
      outgoing: views.filter((m) => m.friendship === "requested"),
    });
  } catch (error) {
    console.error("List friends failed:", error);
    res.status(500).json({ message: "Unable to load friends." });
  }
});

router.post("/requests", friendRequestLimiter, async (req, res) => {
  const other = targetId(req, res, req.body?.userId);
  if (!other) return;

  try {
    if (!(await User.exists({ _id: other }))) {
      return res.status(404).json({ message: "Member not found." });
    }

    const pair = Friendship.pairKey(req.userId, other);
    let link = await Friendship.findOne({ pair });

    if (!link) {
      try {
        await Friendship.create({
          requester: req.userId,
          recipient: other,
          pair,
        });
        res.status(201).json({ status: "requested" });
        return notifyChange(req, other, "request");
      } catch (error) {
        // They sent one at the same moment — fall through and handle it
        if (error.code !== 11000) throw error;
        link = await Friendship.findOne({ pair });
      }
    }

    if (link.status === "accepted") {
      return res.status(200).json({ status: "friends" });
    }
    if (String(link.requester) === String(req.userId)) {
      return res.status(200).json({ status: "requested" });
    }
    // They already asked us: asking back accepts
    link.status = "accepted";
    link.acceptedAt = new Date();
    await link.save();
    res.status(200).json({ status: "friends" });
    notifyChange(req, other, "accept");
  } catch (error) {
    console.error("Send friend request failed:", error);
    res.status(500).json({ message: "Unable to send friend request." });
  }
});

router.delete("/requests/:userId", async (req, res) => {
  const other = targetId(req, res, req.params.userId);
  if (!other) return;
  try {
    const { deletedCount } = await Friendship.deleteOne({
      pair: Friendship.pairKey(req.userId, other),
      status: "pending",
      requester: req.userId,
    });
    if (!deletedCount) {
      return res.status(404).json({ message: "No pending request to cancel." });
    }
    res.status(200).json({ status: "none" });
    notifyChange(req, other, "cancel");
  } catch (error) {
    console.error("Cancel friend request failed:", error);
    res.status(500).json({ message: "Unable to cancel friend request." });
  }
});

router.post("/requests/:userId/accept", async (req, res) => {
  const other = targetId(req, res, req.params.userId);
  if (!other) return;
  try {
    const link = await Friendship.findOneAndUpdate(
      {
        pair: Friendship.pairKey(req.userId, other),
        status: "pending",
        requester: other,
      },
      { status: "accepted", acceptedAt: new Date() },
      { returnDocument: "after" },
    );
    if (!link) {
      return res.status(404).json({ message: "No friend request to accept." });
    }
    res.status(200).json({ status: "friends" });
    notifyChange(req, other, "accept");
  } catch (error) {
    console.error("Accept friend request failed:", error);
    res.status(500).json({ message: "Unable to accept friend request." });
  }
});

router.post("/requests/:userId/decline", async (req, res) => {
  const other = targetId(req, res, req.params.userId);
  if (!other) return;
  try {
    const { deletedCount } = await Friendship.deleteOne({
      pair: Friendship.pairKey(req.userId, other),
      status: "pending",
      requester: other,
    });
    if (!deletedCount) {
      return res.status(404).json({ message: "No friend request to decline." });
    }
    res.status(200).json({ status: "none" });
    notifyChange(req, other, "decline");
  } catch (error) {
    console.error("Decline friend request failed:", error);
    res.status(500).json({ message: "Unable to decline friend request." });
  }
});

router.delete("/:userId", async (req, res) => {
  const other = targetId(req, res, req.params.userId);
  if (!other) return;
  try {
    const { deletedCount } = await Friendship.deleteOne({
      pair: Friendship.pairKey(req.userId, other),
      status: "accepted",
    });
    if (!deletedCount) {
      return res.status(404).json({ message: "You aren't friends with this member." });
    }
    res.status(200).json({ status: "none" });
    notifyChange(req, other, "remove");
  } catch (error) {
    console.error("Unfriend failed:", error);
    res.status(500).json({ message: "Unable to remove friend." });
  }
});

module.exports = router;
