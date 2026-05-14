import { buildApp } from './app';
import { startJobWorker } from './workers/job.worker';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const start = async () => {
  const app = await buildApp();

  app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server running at ${address}`);
  });

  // Start BullMQ worker (synchronous — registers listeners)
  startJobWorker();
};

start();