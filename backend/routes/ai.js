const express = require("express");

const router = express.Router();
const MODEL = "gemma4:e2b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 4;
const MAX_HISTORY_MESSAGE_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 120000;

const SYSTEM_PROMPT = `You are Anny, TaskHero's website help assistant. Give friendly, direct answers, usually 50-120 words. Verified facts: TaskHero's CEO is Junel Mandahuyan. Only mention the CEO's name when the user asks about the CEO or TaskHero leadership; do not include it in introductions or bring it up unprompted. Verified features: Browse tasks searches open task listings by keyword or location and filters by category; users can post tasks with a title, category, budget, location, optional deadline, and description; listings have an Accept task action; navigation includes Browse tasks, My tasks, and Messages; TaskHero has sign-in, registration, and profiles. Never invent features, claim actions are completed, or claim access to private account data. If unsure, say so.`;

function sendEvent(res, event) {
  if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

router.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body || {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, message: "Please enter a message." });
  }
  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ success: false, message: "Please keep messages under 2,000 characters." });
  }
  if (!Array.isArray(history)) {
    return res.status(400).json({ success: false, message: "Conversation history must be a list of messages." });
  }

  const recentHistory = history
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(-MAX_HISTORY_MESSAGE_LENGTH) }))
    .filter((item) => item.content);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortOnDisconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", abortOnDisconnect);

  try {
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        think: false,
        keep_alive: "5m",
        options: { num_ctx: 2048, num_predict: 128, temperature: 0.3 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...recentHistory,
          { role: "user", content: message.trim() },
        ],
      }),
      signal: controller.signal,
    });

    if (!ollamaResponse.ok) {
      const ollamaError = await ollamaResponse.json().catch(() => null);
      const modelUnavailable = ollamaResponse.status === 404 || /model.*not found/i.test(ollamaError?.error || "");
      return res.status(503).json({
        success: false,
        message: modelUnavailable
          ? `Anny's AI model (${MODEL}) is not available. Check that it is installed in Ollama.`
          : "Anny is unavailable right now. Please try again shortly.",
      });
    }

    if (!ollamaResponse.body) {
      return res.status(502).json({ success: false, message: "Anny could not start a response. Please try again." });
    }

    res.status(200);
    res.set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const reader = ollamaResponse.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let receivedText = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error("Ollama stream failed");
        if (chunk.message?.content) {
          receivedText = true;
          sendEvent(res, { type: "chunk", text: chunk.message.content });
        }
        if (chunk.done) sendEvent(res, { type: "done" });
      }
    }

    pending += decoder.decode();
    if (pending.trim()) {
      const chunk = JSON.parse(pending);
      if (chunk.error) throw new Error("Ollama stream failed");
      if (chunk.message?.content) {
        receivedText = true;
        sendEvent(res, { type: "chunk", text: chunk.message.content });
      }
      if (chunk.done) sendEvent(res, { type: "done" });
    }

    if (!receivedText) sendEvent(res, { type: "error", message: "Anny returned an empty response. Please try again." });
    res.end();
  } catch (error) {
    if (res.destroyed || controller.signal.aborted && res.writableEnded) return;
    if (controller.signal.aborted) {
      const message = "Anny took too long to respond. Please try again.";
      if (res.headersSent) {
        sendEvent(res, { type: "error", message });
        res.end();
      } else {
        res.status(504).json({ success: false, message });
      }
      return;
    }
    const message = "Anny is unavailable. Make sure Ollama is running, then try again.";
    if (res.headersSent) {
      sendEvent(res, { type: "error", message });
      res.end();
    } else {
      res.status(503).json({ success: false, message });
    }
  } finally {
    clearTimeout(timeout);
    res.off("close", abortOnDisconnect);
  }
});

module.exports = router;