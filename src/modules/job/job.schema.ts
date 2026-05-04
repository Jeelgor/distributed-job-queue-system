import { z } from 'zod';

export const createJobSchema = z.object({
  type: z.string().min(1, 'Job type is required'),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const updateJobSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  attempts: z.number().int().min(0).optional(),
});

export const jobParamsSchema = z.object({
  id: z.string().uuid('Invalid job ID'),
});

export type CreateJobSchema = z.infer<typeof createJobSchema>;
export type UpdateJobSchema = z.infer<typeof updateJobSchema>;
export type JobParamsSchema = z.infer<typeof jobParamsSchema>;
