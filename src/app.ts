import Fastify from "fastify";

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
  });

  return app;
};