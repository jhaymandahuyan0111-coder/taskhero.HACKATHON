/* =========================================================
   TASKHERO - REVIEWS ROUTES
   Base: /api/reviews
   ========================================================= */

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { requireSession } = require("../auth");

/* ─────────────────────────────────────────────────────────
   POST /api/reviews
   Create a review for a completed task.

   Body: { taskId, reviewerId, revieweeId, stars, text }
   ───────────────────────────────────────────────────────── */
router.post("/", requireSession, (req, res) => {
  const { taskId, revieweeId, stars, text } = req.body;
  const reviewerId = req.user.id;

  // ── Basic validation ────────────────────────────────────
  const errors = [];

  if (!taskId)     errors.push("taskId is required.");
  if (!reviewerId) errors.push("reviewerId is required.");
  if (!revieweeId) errors.push("revieweeId is required.");
  if (!text || !text.trim()) errors.push("Review text is required.");

  const starsNum = Number(stars);
  if (!stars || isNaN(starsNum) || starsNum < 1 || starsNum > 5) {
    errors.push("stars must be an integer between 1 and 5.");
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // ── Can't review yourself ───────────────────────────────
  if (reviewerId === revieweeId) {
    return res.status(400).json({
      success: false,
      message: "You cannot review yourself.",
    });
  }

  // ── Task must exist and be completed ───────────────────
  const task = db.tasks.findById(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }
  if (task.status !== "completed") {
    return res.status(400).json({
      success: false,
      message: "Reviews can only be left for completed tasks.",
    });
  }

  // ── Reviewer must be poster or acceptor ─────────────────
  if (task.postedBy !== reviewerId && task.acceptedBy !== reviewerId) {
    return res.status(403).json({
      success: false,
      message: "Only the task poster or acceptor can leave a review.",
    });
  }

  // ── Reviewee must be the other party ────────────────────
  if (task.postedBy !== revieweeId && task.acceptedBy !== revieweeId) {
    return res.status(400).json({
      success: false,
      message: "revieweeId must be a participant of this task.",
    });
  }

  // ── One review per reviewer per task ────────────────────
  const existing = db.reviews.findByReviewerAndTask(reviewerId, taskId);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "You have already reviewed this task.",
    });
  }

  // ── Verify both users exist ─────────────────────────────
  const reviewer = db.users.findById(reviewerId);
  const reviewee = db.users.findById(revieweeId);
  if (!reviewer || !reviewee) {
    return res.status(400).json({
      success: false,
      message: "Reviewer or reviewee not found.",
    });
  }

  // ── Create review ────────────────────────────────────────
  const review = {
    id:         db.newId("review-"),
    taskId,
    reviewerId,
    revieweeId,
    stars:      Math.round(starsNum),
    text:       text.trim(),
    createdAt:  new Date().toISOString(),
  };

  db.reviews.create(review); // also recalculates reviewee rating

  // Notify reviewee
  db.notifications.create({
    id:        db.newId("notif-"),
    userId:    revieweeId,
    icon:      "Review",
    text:      `${reviewer.name} left you a ${review.stars}-star review!`,
    read:      0,
    createdAt: review.createdAt,
  });

  res.status(201).json({ success: true, data: review });
});

/* ─────────────────────────────────────────────────────────
   GET /api/reviews/:userId
   Get all reviews for a user, with reviewer info attached.
   ───────────────────────────────────────────────────────── */
router.get("/:userId", (req, res) => {
  const { userId } = req.params;

  const reviews = db.reviews.findByReviewee(userId);

  // Attach reviewer name and avatar
  const enriched = reviews.map((r) => {
    const reviewer = db.users.findById(r.reviewerId);
    return {
      ...r,
      reviewerName:   reviewer ? reviewer.name   : "Unknown",
      reviewerAvatar: reviewer ? reviewer.avatar : "?",
    };
  });

  res.json({
    success: true,
    count: enriched.length,
    data: enriched,
  });
});

module.exports = router;
