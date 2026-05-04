import Fastify from "fastify";
import { jobRoutes } from "./modules/job/job.route";

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
  });

  app.register(jobRoutes, { prefix: "/api/jobs" });

  return app;
};