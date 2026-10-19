// Your notifications (the navbar bell). Every route needs a signed-in user.
//
//   GET  /notifications             → { notifications, unread } — newest first
//   POST /notifications/read  { ids? }
//                                   → { unread } — mark some (or all) as read
//   DELETE /notifications           → { cleared, unread } — clear them all
//
// New ones also arrive live as the "notification:new" socket event; clearing
// tells your other open tabs with "notifications:cleared".

const router = require("express").Router();
const Notification = require("../models/notificationModel");
const { requireAuth } = require("../middleware/requireAuth");
const { emitToUser } = require("../services/realtime");

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_LIST = 30;
const MAX_IDS = 100;

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const [docs, unread] = await Promise.all([
      Notification.find({ user: req.userId }).sort({ createdAt: -1 }).limit(MAX_LIST),
      Notification.countDocuments({ user: req.userId, read: false }),
    ]);
    res.status(200).json({ notifications: docs.map((d) => d.toView()), unread });
  } catch (error) {
    console.error("List notifications failed:", error);
    res.status(500).json({ message: "Unable to load notifications." });
  }
});

router.post("/read", async (req, res) => {
  const ids = req.body?.ids;
  if (
    ids !== undefined &&
    (!Array.isArray(ids) ||
      ids.length > MAX_IDS ||
      !ids.every((id) => typeof id === "string" && OBJECT_ID_RE.test(id)))
  ) {
    return res.status(400).json({ message: "Invalid notification ids.", field: "ids" });
  }
  try {
    const filter = { user: req.userId, read: false };
    if (ids) filter._id = { $in: ids };
    await Notification.updateMany(filter, { read: true });
    const unread = await Notification.countDocuments({ user: req.userId, read: false });
    res.status(200).json({ unread });
  } catch (error) {
    console.error("Mark notifications read failed:", error);
    res.status(500).json({ message: "Unable to update notifications." });
  }
});

router.delete("/", async (req, res) => {
  try {
    const { deletedCount } = await Notification.deleteMany({ user: req.userId });
    res.status(200).json({ cleared: deletedCount, unread: 0 });
    emitToUser(req.userId, "notifications:cleared", {});
  } catch (error) {
    console.error("Clear notifications failed:", error);
    res.status(500).json({ message: "Unable to clear notifications." });
  }
});

module.exports = router;
