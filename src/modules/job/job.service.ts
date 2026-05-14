import { prisma } from '../../config/db';
import { jobQueue } from '../../config/queue';
import type { CreateJobInput, UpdateJobInput, Job, JobStatus, JobStats, JobListQuery } from './job.types';

export const jobService = {
  async createJob(input: CreateJobInput): Promise<Job> {
    // 1. Persist to DB — source of truth
    const job = await prisma.job.create({
      data: {
        type: input.type,
        payload: input.payload as any,
        status: 'pending',
      },
    }) as unknown as Job;

    // 2. Push to BullMQ — triggers processing
    await jobQueue.add(job.type, { jobId: job.id });

    return job;
  },

  async getJobs(query: JobListQuery = {}): Promise<Job[]> {
    return prisma.job.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.type && { type: query.type }),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      skip: query.offset ?? 0,
    }) as Promise<Job[]>;
  },

  async getJobById(id: string): Promise<Job | null> {
    return prisma.job.findUnique({
      where: { id },
    }) as Promise<Job | null>;
  },

  async getStats(): Promise<JobStats> {
    const counts = await prisma.job.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const stats: JobStats = { pending: 0, processing: 0, completed: 0, failed: 0 };

    for (const row of counts) {
      const status = row.status as JobStatus;
      if (status in stats) {
        stats[status] = row._count.status;
      }
    }

    return stats;
  },

  async retryJob(id: string): Promise<Job> {
    const job = await prisma.job.findUnique({ where: { id } }) as Job | null;

    if (!job) throw Object.assign(new Error('Job not found'), { statusCode: 404 });
    if (job.status !== 'failed') {
      throw Object.assign(
        new Error(`Only failed jobs can be retried (current status: ${job.status})`),
        { statusCode: 400 }
      );
    }

    // Reset DB state
    const updated = await (prisma.job.update as any)({
      where: { id },
      data: { status: 'pending', attempts: 0, nextRunAt: null },
    }) as Job;

    // Re-enqueue in BullMQ
    await jobQueue.add(job.type, { jobId: job.id });

    return updated;
  },

  async updateJob(id: string, input: UpdateJobInput): Promise<Job | null> {
    return prisma.job.update({
      where: { id },
      data: input,
    }) as Promise<Job>;
  },

  async deleteJob(id: string): Promise<void> {
    await prisma.job.delete({ where: { id } });
  },
};
