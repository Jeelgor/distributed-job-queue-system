import Fastify from "fastify";
import { jobRoutes } from "./modules/job/job.route";
import { corsPlugin } from "./plugins/cors";

export const buildApp = async () => {
  const app = Fastify({
    logger: false, // using pino logger from utils/logger.ts
  });

  app.register(corsPlugin);
  app.register(jobRoutes, { prefix: "/api/jobs" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
};