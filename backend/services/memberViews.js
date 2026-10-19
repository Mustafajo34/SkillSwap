// Builds the public view of members for the signed-in user: profile, skill
// swap stats, friend count, a short "friends with" preview (mutual friends
// first) and how they relate to the viewer. Never includes email, password
// or tokens.

const User = require("../models/userModel");
const Friendship = require("../models/friendshipModel");

// Fields read for a member — nothing private
const MEMBER_FIELDS =
  "firstName lastName userName occupation location bio skills swapCount ratingSum ratingCount photoVersion";

const PREVIEW_SIZE = 3;

const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ");

// Relationship between the viewer and someone else:
//   "friends" | "requested" (viewer asked) | "incoming" (they asked) | "none"
function statusFrom(link, viewerId) {
  if (!link) return "none";
  if (link.status === "accepted") return "friends";
  return String(link.requester) === String(viewerId) ? "requested" : "incoming";
}

async function buildMemberViews(viewerId, users, { skill } = {}) {
  if (users.length === 0) return [];
  const ids = users.map((u) => u._id);

  const [viewerLinks, memberLinks] = await Promise.all([
    Friendship.find({
      $or: [{ requester: viewerId }, { recipient: viewerId }],
    }).lean(),
    Friendship.find({
      status: "accepted",
      $or: [{ requester: { $in: ids } }, { recipient: { $in: ids } }],
    }).lean(),
  ]);

  const viewerFriends = new Set();
  const linkWithViewer = new Map();
  for (const link of viewerLinks) {
    const other = Friendship.otherId(link, viewerId);
    linkWithViewer.set(other, link);
    if (link.status === "accepted") viewerFriends.add(other);
  }

  // memberId → their friends' ids
  const friendsOf = new Map(ids.map((id) => [String(id), new Set()]));
  for (const link of memberLinks) {
    const a = String(link.requester);
    const b = String(link.recipient);
    friendsOf.get(a)?.add(b);
    friendsOf.get(b)?.add(a);
  }

  // Pick each member's preview (mutual friends first), then load the names
  // for every preview in one query
  const previews = new Map();
  const previewIds = new Set();
  for (const [memberId, friends] of friendsOf) {
    const list = [...friends].filter((id) => id !== String(viewerId));
    list.sort((x, y) => viewerFriends.has(y) - viewerFriends.has(x));
    const picked = list.slice(0, PREVIEW_SIZE);
    previews.set(memberId, picked);
    picked.forEach((id) => previewIds.add(id));
  }
  const names = new Map(
    (
      await User.find({ _id: { $in: [...previewIds] } })
        .select("firstName lastName photoVersion")
        .lean()
    ).map((u) => [String(u._id), { name: fullName(u), photoV: u.photoVersion || null }]),
  );

  return users.map((u) => {
    const id = String(u._id);
    const skills = (u.skills || []).map(({ name, level }) => ({ name, level }));
    return {
      id,
      name: fullName(u),
      // Photo version for GET /avatars/:id (null = no photo)
      photoV: u.photoVersion || null,
      userName: u.userName,
      occupation: u.occupation || "",
      location: u.location || "",
      bio: u.bio || "",
      skills,
      // Level for the skill being browsed, when there is one
      level: skill ? skills.find((s) => s.name === skill)?.level || null : null,
      swaps: u.swapCount || 0,
      rating: User.averageRating(u),
      reviews: u.ratingCount || 0,
      friendCount: friendsOf.get(id).size,
      friendsPreview: previews.get(id).map((fid) => ({
        id: fid,
        name: names.get(fid)?.name || "SkillSwap member",
        photoV: names.get(fid)?.photoV || null,
        mutual: viewerFriends.has(fid),
      })),
      friendship: statusFrom(linkWithViewer.get(id), viewerId),
    };
  });
}

module.exports = { buildMemberViews, MEMBER_FIELDS, fullName };
