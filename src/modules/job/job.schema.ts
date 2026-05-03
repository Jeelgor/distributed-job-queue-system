import { z } from 'zod';

export const createJobSchema = z.object({
  name: z.string().min(1, 'Job name is required'),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const updateJobSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
});

export const jobParamsSchema = z.object({
  id: z.string().uuid('Invalid job ID'),
});

export type CreateJobSchema = z.infer<typeof createJobSchema>;
export type UpdateJobSchema = z.infer<typeof updateJobSchema>;
export type JobParamsSchema = z.infer<typeof jobParamsSchema>;
