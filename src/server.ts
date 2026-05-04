import { buildApp } from './app';
import { startJobWorker } from './workers/job.worker';

const start = async () => {
  const app = await buildApp();

  app.listen({ port: 3000 }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server running at ${address}`);
  });

  // Start background worker
  await startJobWorker();
};

start();