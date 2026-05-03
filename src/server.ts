import { buildApp } from "./app";

const start = async () => {
  const app = await buildApp();

  app.listen({ port: 3000 }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server running at ${address}`);
  });
};

start();