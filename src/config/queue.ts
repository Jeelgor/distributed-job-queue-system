import { Queue } from 'bullmq';
import { redis } from './redis';

export const jobQueue = new Queue('job-queue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s, 16s, 32s
    },
    removeOnComplete: 100, // keep last 100 completed jobs
    removeOnFail: 500,     // keep last 500 failed jobs
  },
});
