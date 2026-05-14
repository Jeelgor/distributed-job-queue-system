export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobInput {
  type: string;
  payload: Record<string, unknown>;
}

export interface UpdateJobInput {
  status?: JobStatus | undefined;
  attempts?: number | undefined;
  nextRunAt?: Date | null | undefined;
}

export interface JobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface JobListQuery {
  status?: JobStatus | undefined;
  type?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
