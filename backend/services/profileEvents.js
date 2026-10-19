// Live profile updates, so a change shows up everywhere at once:
//   profile:updated { user }        → your own other tabs/devices
//   member:updated { member }       → everyone signed in, so your card in
//                                     their Browse Skills, Connects, Find
//                                     connects, profile cards, swaps and
//                                     message board updates (only fields any
//                                     member can already see via /members)
//   member:photo   { id, photoV }   → you and your connects, so every
//                                     avatar of you in their app refreshes
//   member:updated { member: { id, swaps, rating, reviews } }
//                                   → everyone, when your rating or swap
//                                     count changes (broadcastStats)

const Friendship = require("../models/friendshipModel");
const User = require("../models/userModel");
const { emitToUser, emitToAll } = require("./realtime");
const { fullName } = require("./memberViews");

// Your public card — nothing private (no email, school, tokens…)
function memberCard(user) {
  const pub = user.toPublic();
  return {
    id: pub.id,
    name: fullName(user),
    userName: pub.userName,
    occupation: pub.occupation || "",
    location: pub.location || "",
    bio: pub.bio || "",
    skills: pub.skills,
    photoV: pub.photoV,
  };
}

function broadcastProfile(user) {
  emitToUser(user.id, "profile:updated", { user: user.toPublic() });
  emitToAll("member:updated", { member: memberCard(user) });
}

async function broadcastPhoto(user) {
  const payload = { id: user.id, photoV: user.toPublic().photoV };
  emitToUser(user.id, "member:photo", payload);
  try {
    const links = await Friendship.find({
      status: "accepted",
      $or: [{ requester: user._id }, { recipient: user._id }],
    })
      .select("requester recipient")
      .lean();
    links.forEach((link) =>
      emitToUser(Friendship.otherId(link, user._id), "member:photo", payload),
    );
  } catch (error) {
    console.error("Photo broadcast failed:", error);
  }
}

// A member's rating or swap count changed (a session/swap rating, a swap
// completed): send the new numbers as a member:updated, so every card,
// list and dashboard showing them updates live.
async function broadcastStats(userIds) {
  try {
    const users = await User.find({ _id: { $in: [].concat(userIds) } })
      .select("swapCount ratingSum ratingCount")
      .lean();
    users.forEach((u) =>
      emitToAll("member:updated", {
        member: {
          id: String(u._id),
          swaps: u.swapCount || 0,
          rating: User.averageRating(u),
          reviews: u.ratingCount || 0,
        },
      }),
    );
  } catch (error) {
    console.error("Stats broadcast failed:", error);
  }
}

module.exports = { broadcastProfile, broadcastPhoto, broadcastStats };
