import type { FastifyInstance } from 'fastify';
import { jobController } from './job.controller';

export async function jobRoutes(app: FastifyInstance) {
  app.post('/', jobController.createJob);
  app.get('/', jobController.getJobs);
  app.get('/stats', jobController.getStats);
  app.get('/:id', jobController.getJobById);
  app.post('/:id/retry', jobController.retryJob);
  app.patch('/:id', jobController.updateJob);
  app.delete('/:id', jobController.deleteJob);
}
