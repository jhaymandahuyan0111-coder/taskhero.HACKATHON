/* =========================================================
   TASKHERO - NOTIFICATIONS ROUTES
   Base: /api/notifications
   ========================================================= */

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { requireSession } = require("../auth");

router.use(requireSession);

router.get("/:userId/unread-count", (req, res) => {
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only view your own notifications." });
  }
  res.json({ success: true, unreadCount: db.notifications.unreadCount(req.user.id) });
});

/* ─────────────────────────────────────────────────────────
   GET /api/notifications/:userId
   Returns all notifications for a user, newest first.
   ───────────────────────────────────────────────────────── */
router.get("/:userId", (req, res) => {
  const { userId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only view your own notifications." });
  }

  const userNotifs = db.notifications.findByUser(userId);

  // SQLite stores read as 0/1 integers; normalise to boolean for the frontend
  const notifs = userNotifs.map((n) => ({ ...n, read: Boolean(n.read) }));

  const unreadCount = notifs.filter((n) => !n.read).length;

  res.json({
    success: true,
    unreadCount,
    count: notifs.length,
    data: notifs,
  });
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/notifications/:userId/read-all
   Marks all notifications as read for a user.
   ───────────────────────────────────────────────────────── */
router.patch("/:userId/read-all", (req, res) => {
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only update your own notifications." });
  }
  db.notifications.markAllRead(req.params.userId);
  res.json({ success: true, message: "All notifications marked as read." });
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/notifications/:id/read
   Marks a single notification as read.
   ───────────────────────────────────────────────────────── */
router.patch("/:id/read", (req, res) => {
  const existing = db.notifications.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Notification not found." });
  }
  if (existing.userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only update your own notifications." });
  }
  const notif = db.notifications.markOneRead(req.params.id);

  if (!notif) {
    return res.status(404).json({ success: false, message: "Notification not found." });
  }

  res.json({ success: true, data: { ...notif, read: true } });
});

module.exports = router;
