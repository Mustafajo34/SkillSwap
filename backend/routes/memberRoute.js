// Members: public profiles for Browse Skills. Every route needs a signed-in
// user (Authorization: Bearer <access token>).
//
//   GET   /members/skills        → { skills, levels } — the skill catalogue
//   GET   /members?skill=Guitar  → { members } — people who teach a skill
//   GET   /members?q=maya        → { members } — search by name, username
//                                  or skill (combine with ?skill= to narrow)
//   GET   /members/:id           → { member }
//   PATCH /members/me            → { user } — update your bio/location/skills

const router = require("express").Router();
const User = require("../models/userModel");
const { requireAuth } = require("../middleware/requireAuth");
const { cleanText } = require("../middleware/validate");
const { looksLikeInjection } = require("../middleware/security");
const { stripInvisible, textSafetyProblem } = require("../services/contentSafety");
const { profileUpdateLimiter } = require("../middleware/rateLimit");
const {
  SKILLS,
  SKILL_LEVELS,
  MAX_PROFILE_SKILLS,
} = require("../data/skills");
const { buildMemberViews, MEMBER_FIELDS } = require("../services/memberViews");
const { broadcastProfile } = require("../services/profileEvents");

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_LIST = 50;
const MAX_QUERY = 50;
const MAX_QUERY_WORDS = 4;

// User text goes into a regex, so escape everything regex treats specially
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "maya chen" → every word must match the first name, last name, username or
// one of their skills (case-insensitive, from the start of a word)
function searchFilter(q) {
  const words = q.split(" ").filter(Boolean).slice(0, MAX_QUERY_WORDS);
  return {
    $and: words.map((word) => {
      const re = new RegExp(`(^|\\s)${escapeRegex(word)}`, "i");
      return {
        $or: [
          { firstName: re },
          { lastName: re },
          { userName: new RegExp(`^${escapeRegex(word)}`, "i") },
          { "skills.name": re },
        ],
      };
    }),
  };
}

router.use(requireAuth);

router.get("/skills", (req, res) => {
  res.status(200).json({ skills: SKILLS, levels: SKILL_LEVELS });
});

router.get("/", async (req, res) => {
  const { skill } = req.query;
  if (skill !== undefined && (typeof skill !== "string" || !SKILLS.includes(skill))) {
    return res.status(400).json({ message: "Unknown skill.", field: "skill" });
  }
  let q = req.query.q;
  if (q !== undefined) {
    if (typeof q !== "string") {
      return res.status(400).json({ message: "Search must be text.", field: "q" });
    }
    q = cleanText(q);
    if (looksLikeInjection(q)) {
      return res.status(400).json({
        message: "Search contains code-like text that isn't allowed.",
        field: "q",
      });
    }
    if (q.length > MAX_QUERY) {
      return res.status(400).json({
        message: `Search must be ${MAX_QUERY} characters or fewer.`,
        field: "q",
      });
    }
  }
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || MAX_LIST, 1), MAX_LIST);

  try {
    const filter = { _id: { $ne: req.userId } };
    if (skill) filter["skills.name"] = skill;
    if (q) Object.assign(filter, searchFilter(q));
    const users = await User.find(filter).select(MEMBER_FIELDS).limit(500).lean();

    // Best first: highest rating (unrated last), then most swaps, then name
    users.sort((a, b) => {
      const ra = User.averageRating(a) ?? -1;
      const rb = User.averageRating(b) ?? -1;
      return (
        rb - ra ||
        (b.swapCount || 0) - (a.swapCount || 0) ||
        a.firstName.localeCompare(b.firstName)
      );
    });

    const members = await buildMemberViews(req.userId, users.slice(0, limit), {
      skill,
    });
    res.status(200).json({ members });
  } catch (error) {
    console.error("List members failed:", error);
    res.status(500).json({ message: "Unable to load members." });
  }
});

// Declared before /:id so "me" isn't treated as an id
router.patch("/me", profileUpdateLimiter, async (req, res) => {
  const body = req.body || {};
  const update = {};

  for (const [field, max] of [
    ["bio", 300],
    ["location", 80],
  ]) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") {
      return res.status(400).json({ message: `${field} must be text.`, field });
    }
    const value = cleanText(stripInvisible(body[field]));
    if (value.length > max) {
      return res
        .status(400)
        .json({ message: `${field} must be ${max} characters or fewer.`, field });
    }
    // Shown to every member: no code, harmful symbols, secrets or phishing
    const problem = textSafetyProblem(value);
    if (problem) return res.status(400).json({ message: problem, field });
    update[field] = value;
  }

  if (body.skills !== undefined) {
    const list = body.skills;
    if (!Array.isArray(list)) {
      return res.status(400).json({ message: "skills must be a list.", field: "skills" });
    }
    if (list.length > MAX_PROFILE_SKILLS) {
      return res.status(400).json({
        message: `You can list up to ${MAX_PROFILE_SKILLS} skills.`,
        field: "skills",
      });
    }
    const seen = new Set();
    const skills = [];
    for (const item of list) {
      const name = item?.name;
      const level = item?.level;
      if (!SKILLS.includes(name)) {
        return res.status(400).json({ message: "Unknown skill.", field: "skills" });
      }
      if (!SKILL_LEVELS.includes(level)) {
        return res.status(400).json({
          message: `Level must be one of: ${SKILL_LEVELS.join(", ")}.`,
          field: "skills",
        });
      }
      if (seen.has(name)) {
        return res
          .status(400)
          .json({ message: `${name} is listed twice.`, field: "skills" });
      }
      seen.add(name);
      skills.push({ name, level });
    }
    update.skills = skills;
  }

  try {
    const user = await User.findByIdAndUpdate(req.userId, update, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!user) return res.status(404).json({ message: "User not found." });
    res.status(200).json({ user: user.toPublic() });
    broadcastProfile(user); // e.g. skills changed → your other tabs update
  } catch (error) {
    if (error.name === "ValidationError") {
      const [field, detail] = Object.entries(error.errors)[0];
      return res.status(400).json({ message: detail.message, field });
    }
    console.error("Profile update failed:", error);
    res.status(500).json({ message: "Unable to update profile." });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!OBJECT_ID_RE.test(id)) {
    return res.status(404).json({ message: "Member not found." });
  }
  try {
    const user = await User.findById(id).select(MEMBER_FIELDS).lean();
    if (!user) return res.status(404).json({ message: "Member not found." });
    const [member] = await buildMemberViews(req.userId, [user]);
    res.status(200).json({ member });
  } catch (error) {
    console.error("Get member failed:", error);
    res.status(500).json({ message: "Unable to load member." });
  }
});

module.exports = router;
