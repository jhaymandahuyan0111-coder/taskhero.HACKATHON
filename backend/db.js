/* =========================================================
   TASKHERO - SQLite Database Layer
   Uses better-sqlite3 (synchronous API — no async/await)
   ========================================================= */

const Database = require('better-sqlite3');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

// ── Open / create the database file ──────────────────────
const db = new Database(path.join(__dirname, 'taskhero.db'));

// Performance & integrity pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password       TEXT NOT NULL,
    avatar         TEXT NOT NULL DEFAULT '',
    banner         TEXT DEFAULT '',
    bio            TEXT DEFAULT '',
    tagline        TEXT DEFAULT '',
    location       TEXT DEFAULT '',
    skills         TEXT DEFAULT '[]',
    expertise      TEXT DEFAULT '[]',
    certs          TEXT DEFAULT '[]',
    portfolio      TEXT DEFAULT '[]',
    workExp        TEXT DEFAULT '[]',
    contact        TEXT DEFAULT '{}',
    rating         REAL DEFAULT 0,
    tasksCompleted INTEGER DEFAULT 0,
    joinedAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_follows (
    followerId  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followingId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt   TEXT NOT NULL,
    PRIMARY KEY (followerId, followingId),
    CHECK (followerId <> followingId)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    budget      REAL NOT NULL,
    location    TEXT NOT NULL,
    deadline    TEXT,
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    postedBy    TEXT NOT NULL REFERENCES users(id),
    acceptedBy  TEXT REFERENCES users(id),
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id           TEXT PRIMARY KEY,
    taskId       TEXT REFERENCES tasks(id),
    participant1 TEXT NOT NULL REFERENCES users(id),
    participant2 TEXT NOT NULL REFERENCES users(id),
    createdAt    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id             TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL REFERENCES conversations(id),
    senderId       TEXT NOT NULL REFERENCES users(id),
    text           TEXT NOT NULL,
    read           INTEGER NOT NULL DEFAULT 0,
    createdAt      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS message_hidden (
    messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hiddenAt  TEXT NOT NULL,
    PRIMARY KEY (messageId, userId)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL REFERENCES users(id),
    icon      TEXT DEFAULT '',
    text      TEXT NOT NULL,
    read      INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         TEXT PRIMARY KEY,
    taskId     TEXT NOT NULL REFERENCES tasks(id),
    reviewerId TEXT NOT NULL REFERENCES users(id),
    revieweeId TEXT NOT NULL REFERENCES users(id),
    stars      INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
    text       TEXT NOT NULL,
    createdAt  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS velo_payment_intents (
    operationId     TEXT PRIMARY KEY,
    userId          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requestHash     TEXT NOT NULL,
    paymentIntentId TEXT NOT NULL UNIQUE,
    checkoutUrl     TEXT NOT NULL,
    amount          TEXT NOT NULL,
    asset           TEXT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL,
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS velo_webhook_deliveries (
    deliveryId     TEXT PRIMARY KEY,
    eventType      TEXT NOT NULL,
    paymentIntentId TEXT,
    receivedAt     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_postedBy    ON tasks(postedBy);
  CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_messages_convId   ON messages(conversationId);
  CREATE INDEX IF NOT EXISTS idx_notifs_userId     ON notifications(userId);
  CREATE INDEX IF NOT EXISTS idx_reviews_revieweeId ON reviews(revieweeId);
`);

if (!db.pragma('table_info(users)').some((column) => column.name === 'banner')) {
  db.exec("ALTER TABLE users ADD COLUMN banner TEXT DEFAULT ''");
}

// Remove orphaned task records before they can reach the feed. Valid tasks
// remain untouched; accepted tasks with a missing acceptor are reopened.
const orphanTaskIds = db.prepare(`
  SELECT id FROM tasks
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.id = tasks.postedBy)
`).all().map((row) => row.id);

db.transaction(() => {
  if (orphanTaskIds.length) {
    const placeholders = orphanTaskIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE taskId IN (${placeholders}))`).run(...orphanTaskIds);
    db.prepare(`DELETE FROM reviews WHERE taskId IN (${placeholders})`).run(...orphanTaskIds);
    db.prepare(`DELETE FROM conversations WHERE taskId IN (${placeholders})`).run(...orphanTaskIds);
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...orphanTaskIds);
  }

  db.prepare(`
    UPDATE tasks
    SET acceptedBy = NULL, status = 'open', updatedAt = ?
    WHERE acceptedBy IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = tasks.acceptedBy)
  `).run(new Date().toISOString());
})();

// ── JSON field helpers ────────────────────────────────────

function parseJson(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

/** Parse all JSON fields on a raw user row from SQLite */
function parseUser(row) {
  if (!row) return undefined;
  return {
    ...row,
    skills:    parseJson(row.skills,    []),
    expertise: parseJson(row.expertise, []),
    certs:     parseJson(row.certs,     []),
    portfolio: parseJson(row.portfolio, []),
    workExp:   parseJson(row.workExp,   []),
    contact:   parseJson(row.contact,   {}),
  };
}

// ── Prepared statements ───────────────────────────────────

// USERS
const stmts = {
  users: {
    findAll:     db.prepare('SELECT * FROM users'),
    findById:    db.prepare('SELECT * FROM users WHERE id = ?'),
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
    insert: db.prepare(`
      INSERT INTO users
        (id, name, email, password, avatar, bio, tagline, location,
         skills, expertise, certs, portfolio, workExp, contact,
         rating, tasksCompleted, joinedAt)
      VALUES
        (@id, @name, @email, @password, @avatar, @bio, @tagline, @location,
         @skills, @expertise, @certs, @portfolio, @workExp, @contact,
         @rating, @tasksCompleted, @joinedAt)
    `),
    avgRating: db.prepare(`
      SELECT AVG(stars) as avg FROM reviews WHERE revieweeId = ?
    `),
    updateRating: db.prepare(`
      UPDATE users SET rating = ? WHERE id = ?
    `),
    updateTasksCompleted: db.prepare(`
      UPDATE users SET tasksCompleted = tasksCompleted + 1 WHERE id = ?
    `),
    followerCount: db.prepare('SELECT COUNT(*) as count FROM user_follows WHERE followingId = ?'),
    followingCount: db.prepare('SELECT COUNT(*) as count FROM user_follows WHERE followerId = ?'),
    follows: db.prepare('SELECT 1 FROM user_follows WHERE followerId = ? AND followingId = ?'),
    follow: db.prepare(`
      INSERT OR IGNORE INTO user_follows (followerId, followingId, createdAt)
      VALUES (?, ?, ?)
    `),
    unfollow: db.prepare('DELETE FROM user_follows WHERE followerId = ? AND followingId = ?'),
    // returns the user rows of everyone who follows :id
    findFollowers: db.prepare(`
      SELECT u.* FROM user_follows uf
      JOIN users u ON u.id = uf.followerId
      WHERE uf.followingId = ?
      ORDER BY uf.createdAt DESC
    `),
    // returns the user rows of everyone :id follows
    findFollowing: db.prepare(`
      SELECT u.* FROM user_follows uf
      JOIN users u ON u.id = uf.followingId
      WHERE uf.followerId = ?
      ORDER BY uf.createdAt DESC
    `),
  },

  tasks: {
    findAll: db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC'),
    findById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    countByStatus: db.prepare('SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status'),
    countUsers: db.prepare('SELECT COUNT(*) as c FROM users'),
    sumCompleted: db.prepare(`SELECT SUM(budget) as total FROM tasks WHERE status = 'completed'`),
    insert: db.prepare(`
      INSERT INTO tasks
        (id, title, category, budget, location, deadline, description,
         status, postedBy, acceptedBy, createdAt, updatedAt)
      VALUES
        (@id, @title, @category, @budget, @location, @deadline, @description,
         @status, @postedBy, @acceptedBy, @createdAt, @updatedAt)
    `),
    deleteById: db.prepare('DELETE FROM tasks WHERE id = ?'),
  },

  conversations: {
    findByUser: db.prepare(`
      SELECT * FROM conversations WHERE participant1 = ? OR participant2 = ?
    `),
    findById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
    findByPairAndTask: db.prepare(`
      SELECT * FROM conversations
      WHERE taskId IS @taskId
        AND ((participant1 = @uid1 AND participant2 = @uid2)
          OR (participant1 = @uid2 AND participant2 = @uid1))
      LIMIT 1
    `),
    insert: db.prepare(`
      INSERT INTO conversations (id, taskId, participant1, participant2, createdAt)
      VALUES (@id, @taskId, @participant1, @participant2, @createdAt)
    `),
  },

  messages: {
    findByConv: db.prepare(`
      SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC
    `),
    insert: db.prepare(`
      INSERT INTO messages (id, conversationId, senderId, text, read, createdAt)
      VALUES (@id, @conversationId, @senderId, @text, @read, @createdAt)
    `),
    markRead: db.prepare(`
      UPDATE messages SET read = 1
      WHERE conversationId = ? AND senderId != ?
    `),
    findById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    hideForUser: db.prepare(`
      INSERT OR IGNORE INTO message_hidden (messageId, userId, hiddenAt)
      VALUES (?, ?, ?)
    `),
    hiddenByUser: db.prepare(`
      SELECT messageId FROM message_hidden WHERE userId = ?
    `),
  },

  notifications: {
    findByUser: db.prepare(`
      SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC
    `),
    insert: db.prepare(`
      INSERT INTO notifications (id, userId, icon, text, read, createdAt)
      VALUES (@id, @userId, @icon, @text, @read, @createdAt)
    `),
    markAllRead: db.prepare(`UPDATE notifications SET read = 1 WHERE userId = ?`),
    markOneRead: db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`),
    findById:    db.prepare('SELECT * FROM notifications WHERE id = ?'),
  },

  reviews: {
    findByReviewee: db.prepare(`
      SELECT * FROM reviews WHERE revieweeId = ? ORDER BY createdAt DESC
    `),
    findByReviewerAndTask: db.prepare(`
      SELECT * FROM reviews WHERE reviewerId = ? AND taskId = ?
    `),
    insert: db.prepare(`
      INSERT INTO reviews (id, taskId, reviewerId, revieweeId, stars, text, createdAt)
      VALUES (@id, @taskId, @reviewerId, @revieweeId, @stars, @text, @createdAt)
    `),
  },
};

// ── Dynamic update builders ───────────────────────────────

const ALLOWED_USER_FIELDS = [
  'name', 'avatar', 'bio', 'tagline', 'location',
  'skills', 'expertise', 'certs', 'portfolio', 'workExp', 'contact', 'banner',
  'rating', 'tasksCompleted',
];

const ALLOWED_TASK_FIELDS = [
  'title', 'category', 'budget', 'location', 'deadline',
  'description', 'status', 'acceptedBy', 'updatedAt',
];

const veloPaymentStmts = {
  findByOperationId: db.prepare('SELECT * FROM velo_payment_intents WHERE operationId = ?'),
  findByIntentId: db.prepare('SELECT * FROM velo_payment_intents WHERE paymentIntentId = ?'),
  insert: db.prepare(`
    INSERT INTO velo_payment_intents
      (operationId, userId, requestHash, paymentIntentId, checkoutUrl, amount, asset, description, status, createdAt, updatedAt)
    VALUES
      (@operationId, @userId, @requestHash, @paymentIntentId, @checkoutUrl, @amount, @asset, @description, @status, @createdAt, @updatedAt)
  `),
  updateStatusByIntent: db.prepare(`
    UPDATE velo_payment_intents SET status = @status, updatedAt = @updatedAt
    WHERE paymentIntentId = @paymentIntentId
  `),
  insertWebhookDelivery: db.prepare(`
    INSERT OR IGNORE INTO velo_webhook_deliveries (deliveryId, eventType, paymentIntentId, receivedAt)
    VALUES (@deliveryId, @eventType, @paymentIntentId, @receivedAt)
  `),
  latestWebhookStatusByIntent: db.prepare(`
    SELECT eventType, receivedAt FROM velo_webhook_deliveries
    WHERE paymentIntentId = ? AND eventType IN ('payment.succeeded', 'payment.failed')
    ORDER BY receivedAt DESC LIMIT 1
  `),
};

const createVeloCheckout = db.transaction((checkout) => {
  veloPaymentStmts.insert.run(checkout);
  const event = veloPaymentStmts.latestWebhookStatusByIntent.get(checkout.paymentIntentId);
  if (event) {
    veloPaymentStmts.updateStatusByIntent.run({
      paymentIntentId: checkout.paymentIntentId,
      status: event.eventType === "payment.succeeded" ? "succeeded" : "failed",
      updatedAt: event.receivedAt,
    });
  }
  return veloPaymentStmts.findByOperationId.get(checkout.operationId);
});

const recordVeloWebhookDelivery = db.transaction((delivery) => {
  const result = veloPaymentStmts.insertWebhookDelivery.run(delivery);
  if (!result.changes) return false;
  if (delivery.status && delivery.paymentIntentId) {
    veloPaymentStmts.updateStatusByIntent.run({
      status: delivery.status,
      updatedAt: delivery.receivedAt,
      paymentIntentId: delivery.paymentIntentId,
    });
  }
  return true;
});

function buildUpdate(table, allowedFields, fields, id) {
  const keys = Object.keys(fields).filter((k) => allowedFields.includes(k));
  if (keys.length === 0) return null; // nothing to update
  const setClauses = keys.map((k) => `${k} = @${k}`).join(', ');
  return db.prepare(`UPDATE ${table} SET ${setClauses} WHERE id = @id`);
}

// ── Demo data ─────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
let demoDataPurged = false;

if (isProduction) {
  const demoUsers = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'];
  const demoTasks = ['task-1', 'task-2', 'task-3', 'task-4'];
  const placeholders = (values) => values.map(() => '?').join(', ');

  db.transaction(() => {
    db.prepare(`DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE participant1 IN (${placeholders(demoUsers)}) OR participant2 IN (${placeholders(demoUsers)}))`).run(...demoUsers, ...demoUsers);
    db.prepare(`DELETE FROM message_hidden WHERE userId IN (${placeholders(demoUsers)})`).run(...demoUsers);
    db.prepare(`DELETE FROM notifications WHERE userId IN (${placeholders(demoUsers)})`).run(...demoUsers);
    db.prepare(`DELETE FROM user_follows WHERE followerId IN (${placeholders(demoUsers)}) OR followingId IN (${placeholders(demoUsers)})`).run(...demoUsers, ...demoUsers);
    db.prepare(`DELETE FROM reviews WHERE reviewerId IN (${placeholders(demoUsers)}) OR revieweeId IN (${placeholders(demoUsers)}) OR taskId IN (${placeholders(demoTasks)})`).run(...demoUsers, ...demoUsers, ...demoTasks);
    db.prepare(`DELETE FROM conversations WHERE participant1 IN (${placeholders(demoUsers)}) OR participant2 IN (${placeholders(demoUsers)}) OR taskId IN (${placeholders(demoTasks)})`).run(...demoUsers, ...demoUsers, ...demoTasks);
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders(demoTasks)}) OR postedBy IN (${placeholders(demoUsers)}) OR acceptedBy IN (${placeholders(demoUsers)})`).run(...demoTasks, ...demoUsers, ...demoUsers);
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders(demoUsers)})`).run(...demoUsers);
  })();
  demoDataPurged = true;
}

const seedCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

if (seedCount === 0 && !demoDataPurged) {
  const seedUsers = [
    {
      id:             'user-1',
      name:           'Alex Johnson',
      email:          'alex@example.com',
      password:       bcrypt.hashSync('password123', 10),
      avatar:         'A',
      bio:            'Experienced freelancer ready to tackle any challenge.',
      tagline:        'Full-Stack Developer & Designer',
      location:       'New York, NY',
      skills:         JSON.stringify(['JavaScript', 'React', 'Node.js', 'UI/UX']),
      expertise:      JSON.stringify([{ name: 'Web Development', level: 'Expert' }, { name: 'Design', level: 'Intermediate' }]),
      certs:          JSON.stringify([]),
      portfolio:      JSON.stringify([]),
      workExp:        JSON.stringify([]),
      contact:        JSON.stringify({ email: 'alex@example.com', phone: '', web: '', linkedin: '', github: '' }),
      rating:         4.8,
      tasksCompleted: 23,
      joinedAt:       new Date('2023-01-15').toISOString(),
    },
    {
      id:             'user-2',
      name:           'Maria Santos',
      email:          'maria@example.com',
      password:       bcrypt.hashSync('password123', 10),
      avatar:         'M',
      bio:            'Graphic designer with 5 years of experience.',
      tagline:        'Creative Graphic Designer',
      location:       'Miami, FL',
      skills:         JSON.stringify(['Photoshop', 'Illustrator', 'Figma', 'Branding']),
      expertise:      JSON.stringify([{ name: 'Graphic Design', level: 'Expert' }]),
      certs:          JSON.stringify([]),
      portfolio:      JSON.stringify([]),
      workExp:        JSON.stringify([]),
      contact:        JSON.stringify({ email: 'maria@example.com', phone: '', web: '', linkedin: '', github: '' }),
      rating:         4.9,
      tasksCompleted: 41,
      joinedAt:       new Date('2023-02-20').toISOString(),
    },
    {
      id:             'user-3',
      name:           'David Kim',
      email:          'david@example.com',
      password:       bcrypt.hashSync('password123', 10),
      avatar:         'D',
      bio:            'IT specialist and computer repair expert.',
      tagline:        'IT Support Specialist',
      location:       'Los Angeles, CA',
      skills:         JSON.stringify(['Hardware Repair', 'Networking', 'Windows', 'Linux']),
      expertise:      JSON.stringify([{ name: 'IT Support', level: 'Expert' }]),
      certs:          JSON.stringify([{ icon: 'CERT', name: 'CompTIA A+', issuer: 'CompTIA', year: '2022' }]),
      portfolio:      JSON.stringify([]),
      workExp:        JSON.stringify([]),
      contact:        JSON.stringify({ email: 'david@example.com', phone: '', web: '', linkedin: '', github: '' }),
      rating:         4.7,
      tasksCompleted: 18,
      joinedAt:       new Date('2023-03-10').toISOString(),
    },
    {
      id:             'user-4',
      name:           'Sarah Williams',
      email:          'sarah@example.com',
      password:       bcrypt.hashSync('password123', 10),
      avatar:         'S',
      bio:            'Professional cleaner and organizer.',
      tagline:        'Home Cleaning Professional',
      location:       'Chicago, IL',
      skills:         JSON.stringify(['Deep Cleaning', 'Organization', 'Eco Products']),
      expertise:      JSON.stringify([{ name: 'Cleaning', level: 'Expert' }]),
      certs:          JSON.stringify([]),
      portfolio:      JSON.stringify([]),
      workExp:        JSON.stringify([]),
      contact:        JSON.stringify({ email: 'sarah@example.com', phone: '', web: '', linkedin: '', github: '' }),
      rating:         5.0,
      tasksCompleted: 67,
      joinedAt:       new Date('2022-11-05').toISOString(),
    },
    {
      id:             'user-5',
      name:           'James Brown',
      email:          'james@example.com',
      password:       bcrypt.hashSync('password123', 10),
      avatar:         'J',
      bio:            'Delivery driver with own vehicle, fast and reliable.',
      tagline:        'Delivery & Logistics Expert',
      location:       'Houston, TX',
      skills:         JSON.stringify(['Delivery', 'Logistics', 'Customer Service']),
      expertise:      JSON.stringify([{ name: 'Delivery', level: 'Expert' }]),
      certs:          JSON.stringify([]),
      portfolio:      JSON.stringify([]),
      workExp:        JSON.stringify([]),
      contact:        JSON.stringify({ email: 'james@example.com', phone: '', web: '', linkedin: '', github: '' }),
      rating:         4.6,
      tasksCompleted: 30,
      joinedAt:       new Date('2023-04-18').toISOString(),
    },
  ];

  const insertUser = db.transaction((users) => {
    for (const u of users) stmts.users.insert.run(u);
  });
  insertUser(seedUsers);

  const now = new Date().toISOString();
  const seedTasks = [
    {
      id:          'task-1',
      title:       'Design a logo for my startup',
      category:    'Graphic Design',
      budget:      150,
      location:    'Remote',
      deadline:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'I need a modern, clean logo for my new tech startup. Looking for something minimal and memorable.',
      status:      'open',
      postedBy:    'user-1',
      acceptedBy:  null,
      createdAt:   now,
      updatedAt:   now,
    },
    {
      id:          'task-2',
      title:       'Fix my laptop — won\'t turn on',
      category:    'Computer / IT',
      budget:      80,
      location:    'Los Angeles, CA',
      deadline:    null,
      description: 'My laptop suddenly stopped turning on. It was working fine yesterday. Need someone to diagnose and fix it.',
      status:      'open',
      postedBy:    'user-2',
      acceptedBy:  null,
      createdAt:   now,
      updatedAt:   now,
    },
    {
      id:          'task-3',
      title:       'Deep clean 2-bedroom apartment',
      category:    'Cleaning',
      budget:      200,
      location:    'Chicago, IL',
      deadline:    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Need a thorough deep clean of my 2-bedroom apartment. Kitchen and bathrooms especially need attention.',
      status:      'accepted',
      postedBy:    'user-1',
      acceptedBy:  'user-4',
      createdAt:   now,
      updatedAt:   now,
    },
    {
      id:          'task-4',
      title:       'Pick up groceries and deliver to my home',
      category:    'Delivery',
      budget:      30,
      location:    'Houston, TX',
      deadline:    null,
      description: 'Need someone to pick up a grocery list from Whole Foods and deliver to my address. List will be provided.',
      status:      'completed',
      postedBy:    'user-3',
      acceptedBy:  'user-5',
      createdAt:   now,
      updatedAt:   now,
    },
  ];

  const insertTask = db.transaction((tasks) => {
    for (const t of tasks) stmts.tasks.insert.run(t);
  });
  insertTask(seedTasks);
}

const localAdminUsername = process.env.LOCAL_ADMIN_USERNAME?.trim().toLowerCase();
const localAdminPassword = process.env.LOCAL_ADMIN_PASSWORD;

if (!isProduction && localAdminUsername && localAdminPassword) {
  const adminEmail = `${localAdminUsername}@localhost.test`;
  const passwordHash = bcrypt.hashSync(localAdminPassword, 12);
  const existingAdmin = stmts.users.findByEmail.get(adminEmail);

  if (existingAdmin) {
    db.prepare('UPDATE users SET password = ? WHERE email = ?').run(passwordHash, adminEmail);
  } else {
    stmts.users.insert.run({
      id:             'local-admin',
      name:           'TaskHero Admin',
      email:          adminEmail,
      password:       passwordHash,
      avatar:         'A',
      bio:            '',
      tagline:        'Local administrator',
      location:       '',
      skills:         '[]',
      expertise:      '[]',
      certs:          '[]',
      portfolio:      '[]',
      workExp:        '[]',
      contact:        '{}',
      rating:         0,
      tasksCompleted: 0,
      joinedAt:       new Date().toISOString(),
    });
  }
}

// ── Exported API ──────────────────────────────────────────

module.exports = {
  /** Generate a prefixed UUID */
  newId(prefix = '') {
    return prefix + crypto.randomUUID();
  },

  /** Expose the raw db instance for advanced use */
  _db: db,

  // ── USERS ───────────────────────────────────────────────
  users: {
    findAll() {
      return stmts.users.findAll.all().map(parseUser);
    },

    findById(id) {
      return parseUser(stmts.users.findById.get(id));
    },

    findByEmail(email) {
      return parseUser(stmts.users.findByEmail.get(email));
    },

    followerCount(id) {
      return stmts.users.followerCount.get(id).count;
    },

    followingCount(id) {
      return stmts.users.followingCount.get(id).count;
    },

    isFollowing(followerId, followingId) {
      return Boolean(stmts.users.follows.get(followerId, followingId));
    },

    follow(followerId, followingId) {
      stmts.users.follow.run(followerId, followingId, new Date().toISOString());
    },

    unfollow(followerId, followingId) {
      stmts.users.unfollow.run(followerId, followingId);
    },

    /** Returns slim user objects for everyone who follows userId */
    findFollowers(userId) {
      return stmts.users.findFollowers.all(userId).map(parseUser);
    },

    /** Returns slim user objects for everyone userId follows */
    findFollowing(userId) {
      return stmts.users.findFollowing.all(userId).map(parseUser);
    },

    /**
     * Returns mutual followers — users where A follows B AND B follows A.
     * These are the "friends" / mutuals.
     */
    findFriends(userId) {
      const followers  = new Set(this.findFollowers(userId).map(u => u.id));
      const following  = this.findFollowing(userId);
      return following.filter(u => followers.has(u.id));
    },

    create(user) {
      const row = {
        id:             user.id,
        name:           user.name,
        email:          user.email,
        password:       user.password,
        avatar:         user.avatar  || '',
        bio:            user.bio     || '',
        tagline:        user.tagline || '',
        location:       user.location || '',
        skills:         JSON.stringify(user.skills    || []),
        expertise:      JSON.stringify(user.expertise || []),
        certs:          JSON.stringify(user.certs     || []),
        portfolio:      JSON.stringify(user.portfolio || []),
        workExp:        JSON.stringify(user.workExp   || []),
        contact:        JSON.stringify(user.contact   || {}),
        rating:         user.rating         || 0,
        tasksCompleted: user.tasksCompleted || 0,
        joinedAt:       user.joinedAt,
      };
      stmts.users.insert.run(row);
      return this.findById(user.id);
    },

    update(id, fields) {
      // Stringify JSON fields if present
      const toSave = { ...fields };
      for (const jsonField of ['skills', 'expertise', 'certs', 'portfolio', 'workExp', 'contact']) {
        if (toSave[jsonField] !== undefined && typeof toSave[jsonField] !== 'string') {
          toSave[jsonField] = JSON.stringify(toSave[jsonField]);
        }
      }

      const stmt = buildUpdate('users', ALLOWED_USER_FIELDS, toSave, id);
      if (stmt) {
        stmt.run({ ...toSave, id });
      }
      return this.findById(id);
    },

    updateRating(id) {
      const row = stmts.users.avgRating.get(id);
      const avg = row && row.avg != null ? Math.round(row.avg * 10) / 10 : 0;
      stmts.users.updateRating.run(avg, id);
    },

    incrementTasksCompleted(id) {
      stmts.users.updateTasksCompleted.run(id);
    },
  },

  // ── TASKS ───────────────────────────────────────────────
  tasks: {
    findAll(filters = {}) {
      let rows = stmts.tasks.findAll.all();

      // Defense in depth for databases created before orphan cleanup existed.
      rows = rows.filter((task) => Boolean(stmts.users.findById.get(task.postedBy)));

      if (filters.category) {
        rows = rows.filter(
          (t) => t.category.toLowerCase() === filters.category.toLowerCase()
        );
      }
      if (filters.status) {
        rows = rows.filter((t) => t.status === filters.status);
      }
      if (filters.postedBy) {
        rows = rows.filter((t) => t.postedBy === filters.postedBy);
      }
      if (filters.acceptedBy) {
        rows = rows.filter((t) => t.acceptedBy === filters.acceptedBy);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        rows = rows.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.location.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q)
        );
      }

      return rows;
    },

    findById(id) {
      return stmts.tasks.findById.get(id) || undefined;
    },

    stats() {
      const rows = stmts.tasks.countByStatus.all();
      const byStatus = {};
      for (const r of rows) byStatus[r.status] = r.cnt;

      const paidRow  = stmts.tasks.sumCompleted.get();
      const userRow  = stmts.tasks.countUsers.get();

      return {
        openTasks:      byStatus['open']      || 0,
        acceptedTasks:  byStatus['accepted']  || 0,
        completedTasks: byStatus['completed'] || 0,
        activeUsers:    userRow.c,
        totalPaid:      paidRow.total || 0,
      };
    },

    create(task) {
      stmts.tasks.insert.run(task);
      return this.findById(task.id);
    },

    update(id, fields) {
      const toSave = { ...fields };
      const stmt = buildUpdate('tasks', ALLOWED_TASK_FIELDS, toSave, id);
      if (stmt) {
        stmt.run({ ...toSave, id });
      }
      return this.findById(id);
    },

    delete(id) {
      stmts.tasks.deleteById.run(id);
      return { deleted: true };
    },
  },

  // ── CONVERSATIONS ────────────────────────────────────────
  conversations: {
    findByUser(userId) {
      return stmts.conversations.findByUser.all(userId, userId);
    },

    findById(id) {
      return stmts.conversations.findById.get(id) || undefined;
    },

    findByPairAndTask(uid1, uid2, taskId) {
      return stmts.conversations.findByPairAndTask.get({
        uid1, uid2, taskId: taskId || null,
      }) || undefined;
    },

    create(conv) {
      stmts.conversations.insert.run(conv);
      return this.findById(conv.id);
    },
  },

  // ── MESSAGES ─────────────────────────────────────────────
  messages: {
    findByConversation(convId) {
      return stmts.messages.findByConv.all(convId);
    },

    create(msg) {
      stmts.messages.insert.run(msg);
      return stmts.messages.findByConv.all(msg.conversationId).find(
        (m) => m.id === msg.id
      );
    },

    markRead(convId, userId) {
      stmts.messages.markRead.run(convId, userId);
    },

    findById(id) {
      return stmts.messages.findById.get(id) || undefined;
    },

    hiddenByUser(userId) {
      return new Set(stmts.messages.hiddenByUser.all(userId).map((row) => row.messageId));
    },

    hideForUser(messageId, userId) {
      stmts.messages.hideForUser.run(messageId, userId, new Date().toISOString());
    },
  },

  // ── NOTIFICATIONS ────────────────────────────────────────
  notifications: {
    findByUser(userId) {
      return stmts.notifications.findByUser.all(userId);
    },

    create(notif) {
      stmts.notifications.insert.run(notif);
    },

    markAllRead(userId) {
      stmts.notifications.markAllRead.run(userId);
    },

    markOneRead(id) {
      stmts.notifications.markOneRead.run(id);
      return stmts.notifications.findById.get(id);
    },
  },

  // ── REVIEWS ──────────────────────────────────────────────
  reviews: {
    findByReviewee(userId) {
      return stmts.reviews.findByReviewee.all(userId);
    },

    findByReviewerAndTask(reviewerId, taskId) {
      return stmts.reviews.findByReviewerAndTask.get(reviewerId, taskId);
    },

    create(review) {
      stmts.reviews.insert.run(review);
      // Recalculate reviewee's avg rating
      module.exports.users.updateRating(review.revieweeId);
      return review;
    },
  },

  // ── VELO CHECKOUT ───────────────────────────────────────
  payments: {
    findCheckoutByOperationId(operationId) {
      return veloPaymentStmts.findByOperationId.get(operationId) || undefined;
    },

    findCheckoutByIntentId(paymentIntentId) {
      return veloPaymentStmts.findByIntentId.get(paymentIntentId) || undefined;
    },

    createCheckout(checkout) {
      return createVeloCheckout(checkout);
    },

    updateCheckoutStatus(paymentIntentId, status, updatedAt) {
      veloPaymentStmts.updateStatusByIntent.run({ status, updatedAt, paymentIntentId });
      return this.findCheckoutByIntentId(paymentIntentId);
    },

    recordWebhookDelivery: recordVeloWebhookDelivery,
  },
};
