/* =========================================================
   TASKHERO - MESSAGES ROUTES
   Base: /api/messages
   ========================================================= */

const express = require("express");
const router  = express.Router();
const db      = require("../db");
const { requireSession } = require("../auth");

router.use(requireSession);

/* ─────────────────────────────────────────────────────────
   GET /api/messages/conversations/:userId
   Returns all conversations for a given user,
   with the last message and unread count attached.
   ───────────────────────────────────────────────────────── */
router.get("/conversations/:userId", (req, res) => {
  const { userId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only view your own conversations." });
  }

  const userConvos = db.conversations.findByUser(userId);

  const result = userConvos.map((conv) => {
    // Messages in this conversation
    const convMessages = db.messages.findByConversation(conv.id);

    const lastMsg = convMessages.at(-1) || null;
    const unread  = convMessages.filter(
      (m) => m.senderId !== userId && !m.read
    ).length;

    // Get the other participant's info
    const otherId = conv.participant1 === userId ? conv.participant2 : conv.participant1;
    const other   = db.users.findById(otherId);

    // Get the related task
    const task = conv.taskId ? db.tasks.findById(conv.taskId) : null;

    return {
      conversationId: conv.id,
      taskId:         conv.taskId,
      taskTitle:      task ? task.title : "Direct conversation",
      taskBudget:     task ? task.budget : 0,
      participant: other
        ? { id: other.id, name: other.name, avatar: other.avatar }
        : { id: otherId, name: "Unknown", avatar: "?" },
      lastMessage:   lastMsg ? lastMsg.text : null,
      lastMessageAt: lastMsg ? lastMsg.createdAt : conv.createdAt,
      unread,
    };
  });

  // Sort by most recent message
  result.sort(
    (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
  );

  res.json({ success: true, count: result.length, data: result });
});

/* ─────────────────────────────────────────────────────────
   GET /api/messages/conversations/:userId/:conversationId
   Returns all messages in a conversation.
   Also marks messages as read.
   ───────────────────────────────────────────────────────── */
router.get("/conversations/:userId/:conversationId", (req, res) => {
  const { userId, conversationId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ success: false, message: "You can only view your own conversations." });
  }

  const conv = db.conversations.findById(conversationId);

  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversation not found." });
  }

  if (conv.participant1 !== userId && conv.participant2 !== userId) {
    return res.status(403).json({
      success: false,
      message: "You are not a participant in this conversation.",
    });
  }

  // Mark incoming messages as read
  db.messages.markRead(conversationId, userId);

  // Fetch messages (already sorted ASC by createdAt)
  const hidden = db.messages.hiddenByUser(userId);
  const convMessages = db.messages
    .findByConversation(conversationId)
    .filter((message) => !hidden.has(message.id));

  // Attach sender info to each message
  const withSender = convMessages.map((m) => {
    const sender = db.users.findById(m.senderId);
    return {
      ...m,
      read:         Boolean(m.read),
      senderName:   sender ? sender.name : "Unknown",
      senderAvatar: sender ? sender.avatar : "?",
      isMe:         m.senderId === userId,
    };
  });

  res.json({ success: true, count: withSender.length, data: withSender });
});

/* ─────────────────────────────────────────────────────────
   POST /api/messages
   Send a new message.

   Body: { conversationId, senderId, text }
   ───────────────────────────────────────────────────────── */
router.post("/", (req, res) => {
  const { conversationId, text } = req.body;
  const senderId = req.user.id;

  // Validation
  if (!conversationId || !senderId || !text || !text.trim()) {
    return res.status(400).json({
      success: false,
      message: "conversationId, senderId, and text are required.",
    });
  }

  // Check conversation exists
  const conv = db.conversations.findById(conversationId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversation not found." });
  }

  // Check sender is a participant
  if (conv.participant1 !== senderId && conv.participant2 !== senderId) {
    return res.status(403).json({
      success: false,
      message: "You are not a participant in this conversation.",
    });
  }

  // Check sender exists
  const sender = db.users.findById(senderId);
  if (!sender) {
    return res.status(400).json({ success: false, message: "Sender not found." });
  }

  const now     = new Date().toISOString();
  const message = {
    id:             db.newId("msg-"),
    conversationId,
    senderId,
    text:           text.trim(),
    read:           0,
    createdAt:      now,
  };

  db.messages.create(message);

  // Notify the other participant
  const recipientId = conv.participant1 === senderId ? conv.participant2 : conv.participant1;
  if (recipientId) {
    const task = conv.taskId ? db.tasks.findById(conv.taskId) : null;
    db.notifications.create({
      id:        db.newId("notif-"),
      userId:    recipientId,
      icon:      "Message",
      text:      `${sender.name} sent you a message${task ? ` about "${task.title}"` : ""}.`,
      read:      0,
      createdAt: now,
    });
  }

  res.status(201).json({
    success: true,
    data: {
      ...message,
      read:         false,
      senderName:   sender.name,
      senderAvatar: sender.avatar,
      isMe:         true,
    },
  });
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/messages/:messageId
   Hide a message for the requesting user only.
   ───────────────────────────────────────────────────────── */
router.delete("/:messageId", (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  const message = db.messages.findById(messageId);

  if (!message) {
    return res.status(404).json({ success: false, message: "Message not found." });
  }
  if (!userId) {
    return res.status(400).json({ success: false, message: "userId is required." });
  }

  const conversation = db.conversations.findById(message.conversationId);
  if (!conversation || (conversation.participant1 !== userId && conversation.participant2 !== userId)) {
    return res.status(403).json({ success: false, message: "You cannot hide this message." });
  }

  db.messages.hideForUser(messageId, userId);
  res.json({ success: true, message: "Message hidden for you." });
});

/* ─────────────────────────────────────────────────────────
   POST /api/messages/conversations
   Start a new conversation.

   Body: { taskId?, initiatorId, recipientId }
   ───────────────────────────────────────────────────────── */
router.post("/conversations", (req, res) => {
  const { taskId, recipientId } = req.body;
  const initiatorId = req.user.id;

  if (!initiatorId || !recipientId) {
    return res.status(400).json({
      success: false,
      message: "initiatorId and recipientId are required.",
    });
  }

  if (initiatorId === recipientId) {
    return res.status(400).json({
      success: false,
      message: "Cannot start a conversation with yourself.",
    });
  }

  // A task is optional for direct user conversations.
  const task = taskId ? db.tasks.findById(taskId) : null;
  if (taskId && !task) {
    return res.status(404).json({ success: false, message: "Task not found." });
  }

  // Check both users exist
  const initiator = db.users.findById(initiatorId);
  const recipient = db.users.findById(recipientId);
  if (!initiator || !recipient) {
    return res.status(400).json({ success: false, message: "One or both users not found." });
  }

  // Check if conversation already exists for this task + pair
  const existing = db.conversations.findByPairAndTask(initiatorId, recipientId, taskId || null);
  if (existing) {
    return res.json({ success: true, data: existing, existing: true });
  }

  const conv = {
    id:           db.newId("conv-"),
    taskId:       taskId || null,
    participant1: initiatorId,
    participant2: recipientId,
    createdAt:    new Date().toISOString(),
  };

  const created = db.conversations.create(conv);

  res.status(201).json({ success: true, data: created });
});

module.exports = router;
