import type { FastifyRequest, FastifyReply } from 'fastify';
import { jobService } from './job.service';
import { createJobSchema, updateJobSchema, jobParamsSchema, jobListQuerySchema } from './job.schema';

export const jobController = {
  async createJob(req: FastifyRequest, reply: FastifyReply) {
    const body = createJobSchema.parse(req.body);
    const job = await jobService.createJob(body);
    return reply.status(201).send(job);
  },

  async getJobs(req: FastifyRequest, reply: FastifyReply) {
    const query = jobListQuerySchema.parse(req.query);
    const jobs = await jobService.getJobs(query);
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

  async getStats(_req: FastifyRequest, reply: FastifyReply) {
    const stats = await jobService.getStats();
    return reply.send(stats);
  },

  async retryJob(req: FastifyRequest, reply: FastifyReply) {
    const { id } = jobParamsSchema.parse(req.params);
    try {
      const job = await jobService.retryJob(id);
      return reply.send(job);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ message: err.message });
    }
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
