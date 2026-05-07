import { Worker, type Job as BullJob } from 'bullmq';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { dlqQueue } from '../config/dlq';
import { logger } from '../utils/logger';
import type { Job } from '../modules/job/job.types';

const QUEUE_NAME = 'job-queue';
const CONCURRENCY = 5;

// Random delay between 3–5 seconds to simulate real work
function simulatedDelay(): Promise<void> {
  const ms = 3000 + Math.random() * 2000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJob(jobId: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } }) as Job | null;
  if (!job) throw new Error(`Job ${jobId} not found in DB`);
  return job;
}

async function markProcessing(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'processing' },
  });
}

async function markCompleted(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'completed' },
  });
}

async function markFailed(jobId: string, attempts: number): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'failed', attempts },
  });
}

// Core processor — called by BullMQ for each job
async function processJob(bullJob: BullJob): Promise<void> {
  const { jobId } = bullJob.data as { jobId: string };
  const attemptNumber = bullJob.attemptsMade + 1;
  const maxAttempts = bullJob.opts.attempts ?? 5;

  logger.info({ jobId, bullJobId: bullJob.id, attempt: attemptNumber }, 'Job received');

  // Fetch full job data from DB
  const job = await fetchJob(jobId);

  // Mark as processing in DB
  await markProcessing(jobId);
  logger.info({ jobId, type: job.type }, 'Job processing');

  // Simulate work
  await simulatedDelay();

  // Randomly fail 20% of the time to exercise retry path
  if (Math.random() < 0.2) {
    throw new Error('Simulated processing failure');
  }

  // Success
  await markCompleted(jobId);
  logger.info({ jobId, type: job.type, attempt: attemptNumber }, 'Job completed successfully');
}

export function startJobWorker(): void {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: redis,
    concurrency: CONCURRENCY,
  });

  worker.on('failed', async (bullJob, err) => {
    if (!bullJob) return;

    const { jobId } = bullJob.data as { jobId: string };
    const attempts = bullJob.attemptsMade;
    const maxAttempts = bullJob.opts.attempts ?? 5;
    const willRetry = attempts < maxAttempts;

    if (willRetry) {
      // BullMQ will automatically retry — reset DB status to pending
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'pending', attempts },
      });

      logger.warn(
        { jobId, attempt: attempts, maxAttempts, err: err.message },
        'Job failed — will retry'
      );
    } else {
      // All attempts exhausted — mark failed in DB and move to DLQ
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      await markFailed(jobId, attempts);

      await dlqQueue.add('failed-job', {
        jobId,
        type: job?.type ?? 'unknown',
        payload: job?.payload ?? {},
        reason: err.message,
        attempts,
        failedAt: new Date().toISOString(),
      });

      logger.error(
        { jobId, type: job?.type, attempt: attempts, maxAttempts, reason: err.message },
        'Job moved to DLQ — max attempts reached'
      );
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  logger.info(
    { queue: QUEUE_NAME, concurrency: CONCURRENCY },
    'BullMQ worker started'
  );
}
