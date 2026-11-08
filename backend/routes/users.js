/* =========================================================
   TASKHERO - USERS ROUTES
   Base: /api/users
   ========================================================= */

const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const db      = require("../db");
const { createSessionToken, optionalSession, requireSession } = require("../auth");
const localAdminEnabled = process.env.NODE_ENV !== "production" && process.env.RENDER !== "true";

function isLocalOrigin(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
}

/* ─────────────────────────────────────────────────────────
   HELPER: strip password from user object
   ───────────────────────────────────────────────────────── */
function safeUser(user) {
  if (!user) return null;
  const { password, isTestAccount, ...rest } = user;
  return rest;
}

function publicUser(user) {
  if (!user) return null;
  const { password, email, contact, isTestAccount, ...rest } = user;
  return rest;
}

/* ─────────────────────────────────────────────────────────
   GET /api/users
   Returns all users (no passwords).
   ───────────────────────────────────────────────────────── */
router.get("/", (req, res) => {
  const users = db.users.findAll();
  res.json({
    success: true,
    count: users.length,
    data: users.map(publicUser),
  });
});

/* ─────────────────────────────────────────────────────────
   GET /api/users/search?q=<term>
   Search users by name (case-insensitive substring match).
   Returns up to 10 results with id, name, avatar, tagline,
   location, rating, tasksCompleted.
   ───────────────────────────────────────────────────────── */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();

  if (!q) {
    return res.json({ success: true, count: 0, data: [] });
  }

  const all = db.users.findAll();
  const matches = all
    .filter((u) => u.name.toLowerCase().includes(q))
    .slice(0, 10)
    .map((u) => ({
      id:             u.id,
      name:           u.name,
      avatar:         u.avatar,
      tagline:        u.tagline,
      location:       u.location,
      rating:         u.rating,
      tasksCompleted: u.tasksCompleted,
    }));

  res.json({ success: true, count: matches.length, data: matches });
});

/* ─────────────────────────────────────────────────────────
   POST /api/users/:id/follow and DELETE /api/users/:id/follow
   Follow or unfollow a user for the requesting account.
   ───────────────────────────────────────────────────────── */
router.post("/:id/follow", requireSession, (req, res) => {
  const following = db.users.findById(req.params.id);
  const follower = db.users.findById(req.user.id);

  if (!follower || !following) {
    return res.status(404).json({ success: false, message: "User not found." });
  }
  if (follower.id === following.id) {
    return res.status(400).json({ success: false, message: "You cannot follow yourself." });
  }

  db.users.follow(follower.id, following.id);
  res.json({
    success: true,
    following: true,
    followerCount: db.users.followerCount(following.id),
  });
});

router.delete("/:id/follow", requireSession, (req, res) => {
  const following = db.users.findById(req.params.id);
  const follower = db.users.findById(req.user.id);

  if (!follower || !following) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  db.users.unfollow(follower.id, following.id);
  res.json({
    success: true,
    following: false,
    followerCount: db.users.followerCount(following.id),
  });
});

router.get("/:id/follow-status", (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found." });

  const viewerId = req.query.viewerId;
  const viewerFollowsTarget  = Boolean(viewerId && db.users.isFollowing(viewerId, user.id));
  const targetFollowsViewer  = Boolean(viewerId && db.users.isFollowing(user.id, viewerId));
  const isMutual             = viewerFollowsTarget && targetFollowsViewer;

  res.json({
    success:        true,
    following:      viewerFollowsTarget,
    followedBack:   targetFollowsViewer,
    isMutual,
    followerCount:  db.users.followerCount(user.id),
    followingCount: db.users.followingCount(user.id),
  });
});

/* ─────────────────────────────────────────────────────────
   GET /api/users/:id/followers
   Returns the list of users who follow :id.
   ───────────────────────────────────────────────────────── */
router.get("/:id/followers", (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found." });

  const list = db.users.findFollowers(user.id).map(u => ({
    id:     u.id,
    name:   u.name,
    avatar: u.avatar,
    tagline: u.tagline,
    location: u.location,
  }));
  res.json({ success: true, count: list.length, data: list });
});

/* ─────────────────────────────────────────────────────────
   GET /api/users/:id/following
   Returns the list of users that :id follows.
   ───────────────────────────────────────────────────────── */
router.get("/:id/following", (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found." });

  const list = db.users.findFollowing(user.id).map(u => ({
    id:     u.id,
    name:   u.name,
    avatar: u.avatar,
    tagline: u.tagline,
    location: u.location,
  }));
  res.json({ success: true, count: list.length, data: list });
});

/* ─────────────────────────────────────────────────────────
   GET /api/users/:id/friends
   Returns mutual followers (both follow each other).
   ───────────────────────────────────────────────────────── */
router.get("/:id/friends", (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found." });

  const list = db.users.findFriends(user.id).map(u => ({
    id:     u.id,
    name:   u.name,
    avatar: u.avatar,
    tagline: u.tagline,
    location: u.location,
  }));
  res.json({ success: true, count: list.length, data: list });
});

/* ─────────────────────────────────────────────────────────
   GET /api/users/:id
   Returns a single user by id.
   Includes their posted tasks and accepted tasks.
   ───────────────────────────────────────────────────────── */
router.get("/:id", optionalSession, (req, res) => {
  const user = db.users.findById(req.params.id);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  const postedTasks   = db.tasks.findAll({ postedBy: user.id });
  const acceptedTasks = db.tasks.findAll({ acceptedBy: user.id });

  res.json({
    success: true,
    data: {
      ...(req.user?.id === user.id ? safeUser(user) : publicUser(user)),
      followerCount: db.users.followerCount(user.id),
      followingCount: db.users.followingCount(user.id),
      postedTasks,
      acceptedTasks,
    },
  });
});

/* ─────────────────────────────────────────────────────────
   POST /api/users/register
   Create a new user account.

   Body: { name, email, password }
   ───────────────────────────────────────────────────────── */
router.post("/register", (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  const errors = [];
  if (!name || name.trim().length < 2)
    errors.push("Name must be at least 2 characters.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("A valid email is required.");
  if (!password || password.length < 6)
    errors.push("Password must be at least 6 characters.");

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // Check duplicate email
  const existing = db.users.findByEmail(email);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "An account with this email already exists.",
    });
  }

  const user = {
    id:             db.newId("user-"),
    name:           name.trim(),
    email:          email.toLowerCase().trim(),
    password:       bcrypt.hashSync(password, 10),
    avatar:         name.trim().charAt(0).toUpperCase(),
    bio:            "",
    tagline:        "",
    location:       "",
    skills:         [],
    expertise:      [],
    certs:          [],
    portfolio:      [],
    workExp:        [],
    contact:        {},
    rating:         0,
    tasksCompleted: 0,
    joinedAt:       new Date().toISOString(),
  };

  const created = db.users.create(user);

  res.status(201).json({ success: true, data: safeUser(created), token: createSessionToken(created.id) });
});

/* ─────────────────────────────────────────────────────────
   POST /api/users/login
   Authenticate a user.

   Body: { email, password }
   ───────────────────────────────────────────────────────── */
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  const username = String(email).trim().toLowerCase();
  const isLocalAdminLogin = Boolean(
    localAdminEnabled &&
    process.env.LOCAL_ADMIN_USERNAME &&
    process.env.LOCAL_ADMIN_PASSWORD &&
    username === process.env.LOCAL_ADMIN_USERNAME.trim().toLowerCase() &&
    isLocalOrigin(req.get("origin")),
  );
  const accountEmail = isLocalAdminLogin
    ? `${process.env.LOCAL_ADMIN_USERNAME.trim().toLowerCase()}@localhost.test`
    : username;
  const user = db.users.findByEmail(accountEmail);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password.",
    });
  }

  res.json({
    success: true,
    message: "Login successful.",
    data: safeUser(user),
    token: createSessionToken(user.id),
  });
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/users/:id
   Update user profile.

   Body: { name?, tagline?, location?, bio?, avatar?,
           skills?, expertise?, certs?, portfolio?,
           workExp?, contact?, banner? }
   ───────────────────────────────────────────────────────── */
router.patch("/:id", requireSession, (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only update your own profile." });
  }
  const user = db.users.findById(req.params.id);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  const {
    name, tagline, location, bio, avatar,
    skills, expertise, certs, portfolio, workExp, contact, banner,
  } = req.body;

  const fields = {};
  if (name      !== undefined) fields.name      = name.trim();
  if (tagline   !== undefined) fields.tagline   = tagline;
  if (location  !== undefined) fields.location  = location;
  if (bio       !== undefined) fields.bio       = bio;
  if (avatar    !== undefined) fields.avatar    = avatar;
  if (skills    !== undefined) fields.skills    = skills;
  if (expertise !== undefined) fields.expertise = expertise;
  if (certs     !== undefined) fields.certs     = certs;
  if (portfolio !== undefined) fields.portfolio = portfolio;
  if (workExp   !== undefined) fields.workExp   = workExp;
  if (contact   !== undefined) fields.contact   = contact;
  if (banner    !== undefined) fields.banner    = banner;

  const updated = db.users.update(req.params.id, fields);

  res.json({ success: true, data: safeUser(updated) });
});

module.exports = router;
