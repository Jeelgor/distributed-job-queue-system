import { prisma } from '../../config/db';
import type { CreateJobInput, UpdateJobInput, Job } from './job.types';

export const jobService = {
  async createJob(input: CreateJobInput): Promise<Job> {
    return prisma.job.create({
      data: {
        name: input.name,
        payload: input.payload,
        status: 'PENDING',
      },
    }) as Promise<Job>;
  },

  async getJobs(): Promise<Job[]> {
    return prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
    }) as Promise<Job[]>;
  },

  async getJobById(id: string): Promise<Job | null> {
    return prisma.job.findUnique({
      where: { id },
    }) as Promise<Job | null>;
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
