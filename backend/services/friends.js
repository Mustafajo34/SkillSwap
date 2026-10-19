// Who someone is connected with (accepted friend requests only), and the
// connect requests that ride along with skill swaps.

const Friendship = require("../models/friendshipModel");
const { emitToUser } = require("./realtime");

// Both people's Connects lists reload. No `by`, so no "wants to connect"
// toast — the swap already has its own notification.
function connectsChanged(swap, type) {
  emitToUser(swap.from, "connects:changed", { type });
  emitToUser(swap.to, "connects:changed", { type });
}

// Set of user-id strings: the user's accepted connects
async function friendIdsOf(userId) {
  const links = await Friendship.find({
    status: "accepted",
    $or: [{ requester: userId }, { recipient: userId }],
  })
    .select("requester recipient")
    .lean();
  return new Set(links.map((link) => Friendship.otherId(link, userId)));
}

// The user plus their connects — whose message-board posts they can see
async function circleOf(userId) {
  const ids = await friendIdsOf(userId);
  ids.add(String(userId));
  return ids;
}

// A swap was proposed: it's a connect request too (unless they already
// have one, either way round, or are already connects)
async function requestFromSwap(swap) {
  try {
    await Friendship.create({
      requester: swap.from,
      recipient: swap.to,
      pair: Friendship.pairKey(swap.from, swap.to),
      swap: swap._id,
    });
    connectsChanged(swap, "request");
  } catch (error) {
    if (error.code !== 11000) console.error("Swap connect request failed:", error);
  }
}

// A swap was accepted: the two of them are connects now
async function acceptFromSwap(swap) {
  try {
    const pair = Friendship.pairKey(swap.from, swap.to);
    const { modifiedCount } = await Friendship.updateOne(
      { pair, status: "pending" },
      { $set: { status: "accepted", acceptedAt: new Date() } },
    );
    if (!modifiedCount) {
      // No request (e.g. one was declined in Connects) — connect them anyway
      try {
        await Friendship.create({
          requester: swap.from,
          recipient: swap.to,
          pair,
          swap: swap._id,
          status: "accepted",
          acceptedAt: new Date(),
        });
      } catch (error) {
        if (error.code === 11000) return; // already connects
        throw error;
      }
    }
    connectsChanged(swap, "accept");
  } catch (error) {
    console.error("Swap connect accept failed:", error);
  }
}

// A pending swap was declined or withdrawn: so is the request it sent
async function dropSwapRequest(swap, type) {
  try {
    const { deletedCount } = await Friendship.deleteOne({
      pair: Friendship.pairKey(swap.from, swap.to),
      status: "pending",
      swap: swap._id,
    });
    if (deletedCount) connectsChanged(swap, type);
  } catch (error) {
    console.error("Swap connect cleanup failed:", error);
  }
}

module.exports = { circleOf, requestFromSwap, acceptFromSwap, dropSwapRequest };
