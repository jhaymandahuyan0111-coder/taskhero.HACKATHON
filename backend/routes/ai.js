const express = require("express");

const router = express.Router();
const { requireSession } = require("../auth");
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 4;
const MAX_HISTORY_MESSAGE_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 120000;

const SYSTEM_PROMPT = `You are Anny, a friendly, capable general-purpose AI assistant. Answer questions across a wide range of topics, including general knowledge, explanations, brainstorming, writing, and technical help; do not limit answers to TaskHero. Match the detail to the question and explain clearly. Be honest about uncertainty and limitations, and do not claim access to live information unless it is provided in the conversation.

For TaskHero-specific questions, use only these verified facts: TaskHero's CEO is Junel Mandahuyan. Only mention the CEO's name when asked about the CEO or TaskHero leadership; do not bring it up unprompted. Browse tasks searches open task listings by keyword or location and filters by category; users can post tasks with a title, category, budget, location, optional deadline, and description; listings have an Accept task action; navigation includes Browse tasks, My tasks, and Messages; TaskHero has sign-in, registration, and profiles. Do not invent other TaskHero features, claim actions are completed, or claim access to private account data. If a TaskHero-specific answer is unknown, say so.`;

function sendEvent(res, event) {
  if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

router.post("/chat", requireSession, async (req, res) => {
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



    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (!globalThis.__taskheroAI && (!accountId || !apiToken)) {
      return res.status(503).json({ success: false,
        message: "Anny needs Cloudflare Workers AI configured on the server." });
    }
    if (!globalThis.__taskheroAI && !/^[a-f0-9]{32}$/i.test(accountId)) {
      return res.status(503).json({ success: false, message: "Anny's Cloudflare account ID needs attention." });
    }
    const response = globalThis.__taskheroAI
      ? new Response(await globalThis.__taskheroAI.run(MODEL, {
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...recentHistory,
            { role: "user", content: message.trim() }],
          stream: true, max_tokens: 384, temperature: 0.3,
        }), { headers: { "Content-Type": "text/event-stream" } })
      : await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...recentHistory,
            { role: "user", content: message.trim() }],
          stream: true,
          max_tokens: 384,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    if (!response.ok) {
      const message = response.status === 429
        ? "Anny has reached its AI usage limit. Please try again later."
        : [401, 403].includes(response.status)
          ? "Anny's Cloudflare access needs attention on the server."
          : "Anny's hosted AI is unavailable. Please try again shortly.";
      return res.status(response.status === 429 ? 429 : 503).json({ success: false, message });
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Cloudflare returned an unexpected response");
    }
    res.status(200).set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const decoder = new TextDecoder();
    let pending = "";
    let dataLines = [];
    let receivedText = false;
    let completed = false;
    function processLine(line) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
        return;
      }
      if (line !== "" || !dataLines.length) return;
      const data = dataLines.join("\n");
      dataLines = [];
      if (data === "[DONE]") {
        completed = true;
        return;
      }
      const event = JSON.parse(data);
      if (event.error || event.errors?.length) throw new Error("Cloudflare stream failed");
      if (typeof event.response === "string" && event.response) {
        receivedText = true;
        sendEvent(res, { type: "chunk", text: event.response });
      }
    }
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      lines.forEach(processLine);
    }
    pending += decoder.decode();
    if (pending) processLine(pending);
    processLine("");
    if (!receivedText || !completed) throw new Error("Incomplete Cloudflare AI response");
    sendEvent(res, { type: "done" });
    res.end();
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
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
    const message = "Anny could not finish its Cloudflare AI response. Please try again.";
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
