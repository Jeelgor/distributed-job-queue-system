import type { FastifyInstance } from 'fastify';
import { jobController } from './job.controller';

export async function jobRoutes(app: FastifyInstance) {
  app.post('/', jobController.createJob);
  app.get('/', jobController.getJobs);
  app.get('/:id', jobController.getJobById);
  app.patch('/:id', jobController.updateJob);
  app.delete('/:id', jobController.deleteJob);
}
