// Skill swaps (the Swap Requests tab). Every route needs a signed-in user.
// A swap: you teach one of your skills in exchange for one of theirs.
//
//   GET    /swaps                    → { swaps, counts }   your swaps, newest first
//   GET    /swaps/count              → { incoming, active } for the sidebar badge
//   GET    /swaps/matches            → { mySkills, matches } people to swap with
//   GET    /swaps/trending           → { days, skills } most-swapped skills lately
//   POST   /swaps  { userId, offer, want, message }       → propose a swap
//   POST   /swaps/:id/accept | decline                    → answer one sent to you
//   POST   /swaps/:id/cancel                              → withdraw / call it off
//   POST   /swaps/:id/complete                            → you met: +1 swap each
//   POST   /swaps/:id/review  { rating }                  → rate them 1–5, once
//
// Swaps are returned from the viewer's side: `youTeach` / `theyTeach`,
// `direction` "sent" | "received", and `other` (their member card).

const router = require("express").Router();
const User = require("../models/userModel");
const SwapRequest = require("../models/swapRequestModel");
const { SKILLS } = require("../data/skills");
const { requireAuth } = require("../middleware/requireAuth");
const { swapLimiter } = require("../middleware/rateLimit");
const { buildMemberViews, MEMBER_FIELDS } = require("../services/memberViews");
const { cleanMultiline } = require("../services/links");
const { stripInvisible, textSafetyProblem } = require("../services/contentSafety");
const { emitToUser } = require("../services/realtime");
const { notify, actorFor } = require("../services/notifications");
const { broadcastStats } = require("../services/profileEvents");
const { requestFromSwap, acceptFromSwap, dropSwapRequest } = require("../services/friends");

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MESSAGE_MAX = 300;
const LIST_LIMIT = 100;
const MATCH_CANDIDATES = 80;
const MATCH_LIMIT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRENDING_WINDOW_MS = 30 * DAY_MS;
const TRENDING_LIMIT = 5;

router.use(requireAuth);

const isSkill = (value) => typeof value === "string" && SKILLS.includes(value);
const skillNames = (user) => (user?.skills || []).map((s) => s.name);

// ── Views ────────────────────────────────────────────────────────────────────

// The viewer's side of each swap, with the other person's member card
async function swapViews(viewerId, swaps) {
  const me = String(viewerId);
  const otherIds = [
    ...new Set(swaps.map((s) => (String(s.from) === me ? String(s.to) : String(s.from)))),
  ];
  const users = await User.find({ _id: { $in: otherIds } }).select(MEMBER_FIELDS).lean();
  const members = new Map(
    (await buildMemberViews(viewerId, users)).map((m) => [m.id, m]),
  );

  return swaps.flatMap((s) => {
    const sent = String(s.from) === me;
    const other = members.get(sent ? String(s.to) : String(s.from));
    if (!other) return []; // their account was deleted
    return [
      {
        id: String(s._id),
        direction: sent ? "sent" : "received",
        status: s.status,
        youTeach: sent ? s.offer : s.want,
        theyTeach: sent ? s.want : s.offer,
        message: s.message || "",
        closedByYou: s.closedBy ? String(s.closedBy) === me : false,
        yourRating: sent ? s.fromRating : s.toRating,
        theirRating: sent ? s.toRating : s.fromRating,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        completedAt: s.completedAt,
        other,
      },
    ];
  });
}

async function countsFor(userId) {
  const [incoming, active] = await Promise.all([
    SwapRequest.countDocuments({ to: userId, status: "pending" }),
    SwapRequest.countDocuments({
      status: "accepted",
      $or: [{ from: userId }, { to: userId }],
    }),
  ]);
  return { incoming, active };
}

// Live update for both people (every open tab reloads its swaps), plus a
// saved notification for the other person when it's something they should
// act on or know about.
async function announce(req, swap, type) {
  try {
    const otherId = String(swap.from) === String(req.userId) ? swap.to : swap.from;
    const by = await actorFor(req.userId);
    const payload = { type, swapId: String(swap._id) };
    emitToUser(otherId, "swaps:changed", { ...payload, by });
    emitToUser(req.userId, "swaps:changed", { ...payload, self: true });
    if (type === "request") {
      await notify(otherId, "swap_request", by, {
        swapId: String(swap._id),
        offer: swap.offer,
        want: swap.want,
      });
    } else if (type !== "review") {
      await notify(otherId, "swap_response", by, { swapId: String(swap._id), response: type });
    }
  } catch (error) {
    console.error("Swap live update failed:", error);
  }
}

// Validates :id; answers the request itself when invalid
function swapId(req, res) {
  if (!OBJECT_ID_RE.test(req.params.id || "")) {
    res.status(400).json({ message: "Invalid swap id." });
    return null;
  }
  return req.params.id;
}

// Moves one swap from a status to another, only if the viewer is allowed to.
// Atomic, so two clicks (or both people at once) can't both succeed.
async function transition(req, res, { who, from, to, extra = {}, notFound }) {
  const id = swapId(req, res);
  if (!id) return null;
  const sides =
    who === "to" ? [{ to: req.userId }] : who === "from" ? [{ from: req.userId }] : [{ from: req.userId }, { to: req.userId }];
  const set = { status: to, open: SwapRequest.OPEN_STATUSES.includes(to), ...extra };
  return SwapRequest.findOneAndUpdate(
    { _id: id, status: { $in: [].concat(from) }, $or: sides },
    { $set: set },
    { returnDocument: "after" },
  ).then((swap) => {
    if (!swap) res.status(404).json({ message: notFound });
    return swap;
  });
}

async function respondWith(req, res, swap, type, status = 200) {
  const [view] = await swapViews(req.userId, [swap.toObject ? swap.toObject() : swap]);
  res.status(status).json({ swap: view || null });
  announce(req, swap, type);
}

// ── Reading ──────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const swaps = await SwapRequest.find({ $or: [{ from: req.userId }, { to: req.userId }] })
      .sort({ updatedAt: -1 })
      .limit(LIST_LIMIT)
      .lean();
    const [views, counts] = await Promise.all([swapViews(req.userId, swaps), countsFor(req.userId)]);
    res.status(200).json({ swaps: views, counts });
  } catch (error) {
    console.error("List swaps failed:", error);
    res.status(500).json({ message: "Unable to load your swaps." });
  }
});

router.get("/count", async (req, res) => {
  try {
    res.status(200).json(await countsFor(req.userId));
  } catch (error) {
    console.error("Count swaps failed:", error);
    res.status(500).json({ message: "Unable to load your swaps." });
  }
});

// Skills the community swaps most: swaps proposed in the last 30 days
// (either side of a swap counts), with the 30 days before for growth, and
// how many members teach each one (the tie-breaker when swaps are quiet).
router.get("/trending", async (req, res) => {
  try {
    const now = Date.now();
    const since = new Date(now - TRENDING_WINDOW_MS);
    const [swaps, teachers] = await Promise.all([
      SwapRequest.aggregate([
        { $match: { createdAt: { $gte: new Date(now - 2 * TRENDING_WINDOW_MS) } } },
        {
          $project: {
            skills: { $setUnion: [["$offer"], ["$want"]] },
            recent: { $gte: ["$createdAt", since] },
          },
        },
        { $unwind: "$skills" },
        { $group: { _id: { skill: "$skills", recent: "$recent" }, n: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $unwind: "$skills" },
        { $group: { _id: "$skills.name", n: { $sum: 1 } } },
      ]),
    ]);

    const stats = new Map();
    const statFor = (name) => {
      if (!stats.has(name)) stats.set(name, { name, swaps: 0, previous: 0, teachers: 0 });
      return stats.get(name);
    };
    for (const { _id, n } of swaps) statFor(_id.skill)[_id.recent ? "swaps" : "previous"] = n;
    for (const { _id, n } of teachers) statFor(_id).teachers = n;

    const skills = [...stats.values()]
      .filter((s) => isSkill(s.name) && (s.swaps || s.teachers))
      .sort((a, b) => b.swaps - a.swaps || b.teachers - a.teachers || a.name.localeCompare(b.name))
      .slice(0, TRENDING_LIMIT)
      .map((s) => ({
        ...s,
        // % change vs the 30 days before; null when there's nothing to compare
        growth: s.previous ? Math.round(((s.swaps - s.previous) / s.previous) * 100) : null,
      }));
    res.status(200).json({ days: TRENDING_WINDOW_MS / DAY_MS, skills });
  } catch (error) {
    console.error("Trending skills failed:", error);
    res.status(500).json({ message: "Unable to load trending skills." });
  }
});

// People who teach something you don't. Ranked by how well it goes both
// ways (they also lack skills you teach), then experience. People you
// already have an open swap with are left out — they're in your list.
router.get("/matches", async (req, res) => {
  try {
    const [me, open] = await Promise.all([
      User.findById(req.userId).select("skills").lean(),
      SwapRequest.find({ open: true, $or: [{ from: req.userId }, { to: req.userId }] })
        .select("from to")
        .lean(),
    ]);
    const mine = skillNames(me);
    const exclude = [req.userId, ...open.map((s) => (String(s.from) === String(req.userId) ? s.to : s.from))];

    const candidates = await User.find({
      _id: { $nin: exclude },
      skills: { $elemMatch: { name: { $nin: mine } } },
    })
      .select(MEMBER_FIELDS)
      .sort({ swapCount: -1, ratingCount: -1 })
      .limit(MATCH_CANDIDATES)
      .lean();

    const scored = candidates
      .map((u) => {
        const theirs = skillNames(u);
        const teachesYou = theirs.filter((n) => !mine.includes(n));
        const learnsFromYou = mine.filter((n) => !theirs.includes(n));
        // Both directions count; a two-way match beats a one-sided one
        const score = Math.min(teachesYou.length, 3) * 2 + Math.min(learnsFromYou.length, 3) * 3;
        return { u, teachesYou, learnsFromYou, score };
      })
      .sort((a, b) => b.score - a.score || (b.u.swapCount || 0) - (a.u.swapCount || 0))
      .slice(0, MATCH_LIMIT);

    const views = await buildMemberViews(req.userId, scored.map((s) => s.u));
    res.status(200).json({
      mySkills: mine,
      matches: views.map((m, i) => ({
        ...m,
        teachesYou: scored[i].teachesYou,
        learnsFromYou: scored[i].learnsFromYou,
      })),
    });
  } catch (error) {
    console.error("Swap matches failed:", error);
    res.status(500).json({ message: "Unable to load swap matches." });
  }
});

// ── Changing ─────────────────────────────────────────────────────────────────

router.post("/", swapLimiter, async (req, res) => {
  const { userId, offer, want, message: rawMessage } = req.body || {};

  if (typeof userId !== "string" || !OBJECT_ID_RE.test(userId)) {
    return res.status(400).json({ message: "Invalid member.", field: "userId" });
  }
  if (userId === String(req.userId)) {
    return res.status(400).json({ message: "You can't swap skills with yourself." });
  }
  if (!isSkill(offer)) {
    return res.status(400).json({ message: "Choose a skill you'll teach.", field: "offer" });
  }
  if (!isSkill(want)) {
    return res.status(400).json({ message: "Choose a skill you want to learn.", field: "want" });
  }
  if (rawMessage !== undefined && rawMessage !== null && typeof rawMessage !== "string") {
    return res.status(400).json({ message: "Message must be text.", field: "message" });
  }
  const message = cleanMultiline(stripInvisible(rawMessage));
  if (message.length > MESSAGE_MAX) {
    return res
      .status(400)
      .json({ message: `Message must be ${MESSAGE_MAX} characters or fewer.`, field: "message" });
  }
  const messageProblem = textSafetyProblem(message);
  if (messageProblem) return res.status(400).json({ message: messageProblem, field: "message" });

  try {
    const [me, them] = await Promise.all([
      User.findById(req.userId).select("skills").lean(),
      User.findById(userId).select("skills firstName").lean(),
    ]);
    if (!them) return res.status(404).json({ message: "Member not found." });
    if (!skillNames(me).includes(offer)) {
      return res
        .status(400)
        .json({ message: "Add that skill to your profile before offering it.", field: "offer" });
    }
    if (!skillNames(them).includes(want)) {
      return res
        .status(400)
        .json({ message: `${them.firstName || "They"} doesn't teach that skill.`, field: "want" });
    }

    let swap;
    try {
      swap = await SwapRequest.create({
        from: req.userId,
        to: userId,
        pair: SwapRequest.pairKey(req.userId, userId),
        offer,
        want,
        message,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      return res.status(409).json({
        message: "You already have an open swap with this member — see your swap list.",
      });
    }
    await requestFromSwap(swap);
    await respondWith(req, res, swap, "request", 201);
  } catch (error) {
    console.error("Propose swap failed:", error);
    res.status(500).json({ message: "Unable to send your swap request." });
  }
});

const ACTIONS = {
  accept: {
    who: "to",
    from: "pending",
    to: "accepted",
    extra: () => ({ respondedAt: new Date() }),
    notFound: "This swap request is no longer waiting for you.",
  },
  decline: {
    who: "to",
    from: "pending",
    to: "declined",
    extra: (req) => ({ respondedAt: new Date(), closedBy: req.userId }),
    notFound: "This swap request is no longer waiting for you.",
  },
  // Either person can call off an accepted swap; only the sender can
  // withdraw one that hasn't been answered
  cancel: { notFound: "This swap can't be cancelled any more." },
  complete: {
    who: "either",
    from: "accepted",
    to: "completed",
    extra: (req) => ({ completedAt: new Date(), closedBy: req.userId }),
    notFound: "Only accepted swaps can be marked complete.",
  },
};

for (const [type, action] of Object.entries(ACTIONS)) {
  router.post(`/:id/${type}`, swapLimiter, async (req, res) => {
    try {
      let swap;
      if (type === "cancel") {
        const id = swapId(req, res);
        if (!id) return;
        swap = await SwapRequest.findOneAndUpdate(
          {
            _id: id,
            $or: [
              { status: "pending", from: req.userId },
              { status: "accepted", from: req.userId },
              { status: "accepted", to: req.userId },
            ],
          },
          { $set: { status: "cancelled", open: false, closedBy: req.userId } },
          { returnDocument: "after" },
        );
        if (!swap) return res.status(404).json({ message: action.notFound });
      } else {
        swap = await transition(req, res, { ...action, extra: action.extra(req) });
        if (!swap) return;
      }
      // A finished swap counts for both people (only once — the status
      // change above can only succeed once)
      if (type === "complete") {
        await User.updateMany({ _id: { $in: [swap.from, swap.to] } }, { $inc: { swapCount: 1 } });
        broadcastStats([swap.from, swap.to]);
      }
      // Swapping makes you connects; a request that only came with the
      // swap goes away if the swap is turned down or withdrawn
      if (type === "accept") await acceptFromSwap(swap);
      if (type === "decline" || type === "cancel") await dropSwapRequest(swap, type);
      await respondWith(req, res, swap, type);
    } catch (error) {
      console.error(`Swap ${type} failed:`, error);
      res.status(500).json({ message: "Unable to update this swap." });
    }
  });
}

router.post("/:id/review", swapLimiter, async (req, res) => {
  const id = swapId(req, res);
  if (!id) return;
  const rating = req.body?.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Choose 1 to 5 stars.", field: "rating" });
  }
  try {
    // Your rating is stored on your side; it can only be set once
    const swap =
      (await SwapRequest.findOneAndUpdate(
        { _id: id, status: "completed", from: req.userId, fromRating: null },
        { $set: { fromRating: rating } },
        { returnDocument: "after" },
      )) ||
      (await SwapRequest.findOneAndUpdate(
        { _id: id, status: "completed", to: req.userId, toRating: null },
        { $set: { toRating: rating } },
        { returnDocument: "after" },
      ));
    if (!swap) {
      return res.status(404).json({ message: "You've already rated this swap, or it isn't finished." });
    }
    const otherId = String(swap.from) === String(req.userId) ? swap.to : swap.from;
    await User.updateOne({ _id: otherId }, { $inc: { ratingSum: rating, ratingCount: 1 } });
    broadcastStats(otherId);
    await respondWith(req, res, swap, "review");
  } catch (error) {
    console.error("Swap review failed:", error);
    res.status(500).json({ message: "Unable to save your rating." });
  }
});

module.exports = router;
