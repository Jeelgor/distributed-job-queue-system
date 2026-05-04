import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import type { Job } from '../modules/job/job.types';

const POLL_INTERVAL_MS = 2000;

// Atomically claim one pending job by updating its status to 'processing'
// in a single query — prevents race conditions when multiple workers run.
async function claimNextJob(): Promise<Job | null> {
  const results = await prisma.$queryRaw<Job[]>`
    UPDATE "Job"
    SET status = 'processing', "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'pending'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  return results[0] ?? null;
}

// Simulate job processing — replace with real logic later
async function processJob(job: Job): Promise<void> {
  logger.info({ jobId: job.id, type: job.type }, 'Processing job');

  // Simulate async work (e.g. sending email, calling API)
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  // Randomly fail 20% of the time to exercise the failure path
  if (Math.random() < 0.2) {
    throw new Error('Simulated processing failure');
  }
}

async function tick(): Promise<void> {
  const job = await claimNextJob();

  if (!job) {
    logger.debug('No pending jobs found');
    return;
  }

  logger.info({ jobId: job.id, type: job.type }, 'Claimed job');

  try {
    await processJob(job);

    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'completed' },
    });

    logger.info({ jobId: job.id }, 'Job completed');
  } catch (err) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'failed', attempts: { increment: 1 } },
    });

    logger.error({ jobId: job.id, err }, 'Job failed');
  }
}

export async function startJobWorker(): Promise<void> {
  logger.info('Job worker started');

  const run = async () => {
    try {
      await tick();
    } catch (err) {
      // Catch unexpected errors (e.g. DB connection lost) so the loop survives
      logger.error({ err }, 'Unexpected worker error');
    } finally {
      setTimeout(run, POLL_INTERVAL_MS);
    }
  };

  // Kick off the loop
  void run();
}
