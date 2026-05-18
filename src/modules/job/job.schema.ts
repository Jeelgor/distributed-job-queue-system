import { z } from 'zod';

export const createJobSchema = z.object({
  type: z.string().min(1, 'Job type is required'),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const updateJobSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  attempts: z.number().int().min(0).optional(),
  nextRunAt: z.coerce.date().nullable().optional(),
});

export const jobParamsSchema = z.object({
  id: z.string().uuid('Invalid job ID'),
});

export const jobListQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateJobSchema = z.infer<typeof createJobSchema>;
export type UpdateJobSchema = z.infer<typeof updateJobSchema>;
export type JobParamsSchema = z.infer<typeof jobParamsSchema>;
export type JobListQuerySchema = z.infer<typeof jobListQuerySchema>;
