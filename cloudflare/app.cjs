/* Lazy route loading lets durable storage initialize before backend/db.js. */
module.exports = function createApp() {
  const express = require("../backend/node_modules/express");
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (req, res) => res.json({ success: true, service: "taskhero-cloudflare" }));
  app.use("/api/tasks", require("../backend/routes/tasks"));
  app.use("/api/users", require("../backend/routes/users"));
  app.use("/api/messages", require("../backend/routes/messages"));
  app.use("/api/notifications", require("../backend/routes/notifications"));
  app.use("/api/reviews", require("../backend/routes/reviews"));
  app.use("/api/ai", require("../backend/routes/ai"));
  app.use("/api/payments", require("../backend/routes/payments"));
  app.use((req, res) => res.status(404).json({ success: false, message: "API route not found." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("TaskHero request failed", error.name);
    res.status(error.type === "entity.parse.failed" ? 400 : 500).json({
      success: false, message: "The request could not be completed.",
    });
  });
  return app;
};
