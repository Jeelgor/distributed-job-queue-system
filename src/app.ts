import Fastify from "fastify";
import cors from "@fastify/cors";
import { jobRoutes } from "./modules/job/job.route";

export const buildApp = async () => {
  const app = Fastify({
    logger: false, // using pino logger from utils/logger.ts
  });

  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ? process.env['CORS_ORIGIN'].split(',') : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.register(jobRoutes, { prefix: "/api/jobs" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
};