import type { FastifyRequest, FastifyReply } from 'fastify';
import { jobService } from './job.service';
import { createJobSchema, updateJobSchema, jobParamsSchema } from './job.schema';

export const jobController = {
  async createJob(req: FastifyRequest, reply: FastifyReply) {
    const body = createJobSchema.parse(req.body);
    const job = await jobService.createJob(body);
    return reply.status(201).send(job);
  },

  async getJobs(_req: FastifyRequest, reply: FastifyReply) {
    const jobs = await jobService.getJobs();
    return reply.send(jobs);
  },

  async getJobById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = jobParamsSchema.parse(req.params);
    const job = await jobService.getJobById(id);
    if (!job) {
      return reply.status(404).send({ message: 'Job not found' });
    }
    return reply.send(job);
  },

  async updateJob(req: FastifyRequest, reply: FastifyReply) {
    const { id } = jobParamsSchema.parse(req.params);
    const body = updateJobSchema.parse(req.body);
    const job = await jobService.updateJob(id, body);
    if (!job) {
      return reply.status(404).send({ message: 'Job not found' });
    }
    return reply.send(job);
  },

  async deleteJob(req: FastifyRequest, reply: FastifyReply) {
    const { id } = jobParamsSchema.parse(req.params);
    await jobService.deleteJob(id);
    return reply.status(204).send();
  },
};
