// Creates a notification and delivers it immediately: it's saved (so it's
// there after a reload or for someone who was offline) and pushed over
// Socket.IO as "notification:new" to every tab the user has open.

const User = require("../models/userModel");
const Notification = require("../models/notificationModel");
const { emitToUser } = require("./realtime");
const { fullName } = require("./memberViews");

// { id, name, photoV } for the person who did something
async function actorFor(userId) {
  const user = await User.findById(userId)
    .select("firstName lastName photoVersion")
    .lean();
  return {
    id: String(userId),
    name: fullName(user || {}) || "A SkillSwap member",
    photoV: user?.photoVersion || null,
  };
}

// Never throws — a failed notification mustn't fail the action behind it
async function notify(userId, type, actor, data = {}) {
  try {
    const doc = await Notification.create({ user: userId, type, actor, data });
    const view = doc.toView();
    emitToUser(userId, "notification:new", view);
    return view;
  } catch (error) {
    console.error(`Notification (${type}) failed:`, error);
    return null;
  }
}

module.exports = { notify, actorFor };
