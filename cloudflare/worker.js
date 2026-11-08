import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import { createServer } from "node:http";
import createApp from "./app.cjs";

export class TaskHeroDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      if (!env.TASKHERO_SESSION_SECRET) throw new Error("Session secret is required");
      globalThis.__taskheroStorage = ctx.storage;
      globalThis.__taskheroAI = env.AI;
      this.server = createServer(createApp());
      this.server.listen(0);
    });
  }

  async fetch(request) {
    await this.ready;
    globalThis.__taskheroStorage = this.ctx.storage;
    return handleAsNodeRequest(this.server.address().port, request);
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return env.TASKHERO_DB.get(env.TASKHERO_DB.idFromName("primary")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
