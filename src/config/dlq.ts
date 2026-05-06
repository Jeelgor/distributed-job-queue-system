import { Queue } from 'bullmq';
import { redis } from './redis';

export const dlqQueue = new Queue('job-dlq', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: false, // keep all DLQ entries — they need manual review
    removeOnFail: false,
  },
});
