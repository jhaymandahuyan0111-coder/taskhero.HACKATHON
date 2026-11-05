/* =========================================================
   TASKHERO - TASKS ROUTES
   Base: /api/tasks
   ========================================================= */

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { requireSession } = require("../auth");

/* ─────────────────────────────────────────────────────────
   VALID CATEGORIES
   ───────────────────────────────────────────────────────── */
const VALID_CATEGORIES = [
  "Image Editing",
  "Delivery",
  "Cleaning",
  "Computer / IT",
  "School / Academic",
  "Moving",
  "Graphic Design",
  "Other",
];

/* ─────────────────────────────────────────────────────────
   GET /api/tasks
   Returns all tasks (supports filtering + search).

   Query params:
   - category  : filter by category
   - search    : text search on title, description, location
   - status    : filter by status (open / accepted / completed)
   - postedBy  : filter by user id
   - acceptedBy: filter by user id
   ───────────────────────────────────────────────────────── */
router.get("/", (req, res) => {
  const { category, search, status, postedBy, acceptedBy } = req.query;

  const tasks = db.tasks.findAll({ category, search, status, postedBy, acceptedBy });

  // Attach slim poster info to every task; drop tasks whose poster no longer
  // exists in the database (orphan guard — prevents "no account posted" cards).
  const data = tasks.reduce((acc, task) => {
    const poster = db.users.findById(task.postedBy);
    if (!poster) return acc; // skip orphaned tasks silently
    acc.push({
      ...task,
      poster: { id: poster.id, name: poster.name, avatar: poster.avatar, rating: poster.rating },
    });
    return acc;
  }, []);

  res.json({
    success: true,
    count: data.length,
    data,
  });
});

/* ─────────────────────────────────────────────────────────
   GET /api/tasks/stats
   Returns aggregate stats for the home page.
   ───────────────────────────────────────────────────────── */
router.get("/stats", (req, res) => {
  const data = db.tasks.stats();
  res.json({ success: true, data });
});

/* ─────────────────────────────────────────────────────────
   GET /api/tasks/:id
   Returns a single task by id.
   ───────────────────────────────────────────────────────── */
router.get("/:id", (req, res) => {
  const task = db.tasks.findById(req.params.id);

  if (!task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }

  // Attach poster info (without password)
  const poster = db.users.findById(task.postedBy);
  const result = {
    ...task,
    poster: poster
      ? { id: poster.id, name: poster.name, avatar: poster.avatar, rating: poster.rating }
      : null,
  };

  res.json({ success: true, data: result });
});

/* ─────────────────────────────────────────────────────────
   POST /api/tasks
   Create a new task.

   Body: { title, category, budget, location, deadline?, description, postedBy }
   ───────────────────────────────────────────────────────── */
router.post("/", requireSession, (req, res) => {
  const { title, category, budget, location, deadline, description } = req.body;
  const postedBy = req.user.id;

  // ── Validation ──────────────────────────────────────────
  const errors = [];

  if (!title || title.trim().length < 5)
    errors.push("Title must be at least 5 characters.");

  if (!category || !VALID_CATEGORIES.includes(category))
    errors.push("Invalid or missing category.");

  if (!budget || isNaN(budget) || Number(budget) < 1)
    errors.push("Budget must be a positive number.");

  if (!location || location.trim().length < 2)
    errors.push("Location is required.");

  if (!description || description.trim().length < 10)
    errors.push("Description must be at least 10 characters.");

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // ── Verify user exists ──────────────────────────────────
  const user = db.users.findById(postedBy);
  if (!user) {
    return res.status(400).json({ success: false, message: "User not found." });
  }

  // ── Create task ─────────────────────────────────────────
  const now  = new Date().toISOString();
  const task = {
    id:          db.newId("task-"),
    title:       title.trim(),
    category,
    budget:      Number(budget),
    location:    location.trim(),
    deadline:    deadline || null,
    description: description.trim(),
    status:      "open",
    postedBy,
    acceptedBy:  null,
    createdAt:   now,
    updatedAt:   now,
  };

  const created = db.tasks.create(task);

  // Add notification for poster
  db.notifications.create({
    id:        db.newId("notif-"),
    userId:    postedBy,
    icon:      "Task posted",
    text:      `Your task "${task.title}" is now live!`,
    read:      0,
    createdAt: now,
  });

  res.status(201).json({ success: true, data: created });
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/tasks/:id/accept
   Accept a task.

   Body: { acceptedBy }
   ───────────────────────────────────────────────────────── */
router.patch("/:id/accept", requireSession, (req, res) => {
  const task = db.tasks.findById(req.params.id);

  if (!task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }

  if (task.status !== "open") {
    return res.status(400).json({
      success: false,
      message: `Task is already ${task.status}.`,
    });
  }

  const acceptedBy = req.user.id;

  const acceptor = db.users.findById(acceptedBy);
  if (!acceptor) {
    return res.status(400).json({ success: false, message: "User not found." });
  }

  if (task.postedBy === acceptedBy) {
    return res.status(400).json({
      success: false,
      message: "You cannot accept your own task.",
    });
  }

  // Update task
  const now     = new Date().toISOString();
  const updated = db.tasks.update(task.id, {
    status:     "accepted",
    acceptedBy,
    updatedAt:  now,
  });

  // Notify the task poster
  db.notifications.create({
    id:        db.newId("notif-"),
    userId:    task.postedBy,
    icon:      "Task accepted",
    text:      `${acceptor.name} accepted your task "${task.title}".`,
    read:      0,
    createdAt: now,
  });

  // Create a conversation between poster and acceptor if one doesn't exist
  const existingConv = db.conversations.findByPairAndTask(
    task.postedBy, acceptedBy, task.id
  );

  if (!existingConv) {
    db.conversations.create({
      id:           db.newId("conv-"),
      taskId:       task.id,
      participant1: task.postedBy,
      participant2: acceptedBy,
      createdAt:    now,
    });
  }

  res.json({ success: true, data: updated });
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/tasks/:id/complete
   Mark a task as completed.

   Body: { userId } - must be the poster or acceptor
   ───────────────────────────────────────────────────────── */
router.patch("/:id/complete", requireSession, (req, res) => {
  const task = db.tasks.findById(req.params.id);

  if (!task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }

  if (task.status !== "accepted") {
    return res.status(400).json({
      success: false,
      message: "Only accepted tasks can be marked complete.",
    });
  }

  const userId = req.user.id;
  if (task.acceptedBy !== userId && task.postedBy !== userId) {
    return res.status(403).json({
      success: false,
      message: "Only the task poster or acceptor can mark it complete.",
    });
  }

  const now     = new Date().toISOString();
  const updated = db.tasks.update(task.id, {
    status:    "completed",
    updatedAt: now,
  });

  // Increment acceptor's completed count
  if (task.acceptedBy) {
    db.users.incrementTasksCompleted(task.acceptedBy);
  }

  // Notify poster
  db.notifications.create({
    id:        db.newId("notif-"),
    userId:    task.postedBy,
    icon:      "Task completed",
    text:      `Task "${task.title}" has been completed!`,
    read:      0,
    createdAt: now,
  });

  res.json({ success: true, data: updated });
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/tasks/:id
   Delete a task (only by the poster).

   Body: { userId }
   ───────────────────────────────────────────────────────── */
router.delete("/:id", requireSession, (req, res) => {
  const task = db.tasks.findById(req.params.id);

  if (!task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }

  const userId = req.user.id;

  if (task.postedBy !== userId) {
    return res.status(403).json({
      success: false,
      message: "Only the task poster can delete this task.",
    });
  }

  if (task.status === "accepted") {
    return res.status(400).json({
      success: false,
      message: "Cannot delete a task that has already been accepted.",
    });
  }

  db.tasks.delete(task.id);

  res.json({ success: true, message: "Task deleted." });
});

module.exports = router;
