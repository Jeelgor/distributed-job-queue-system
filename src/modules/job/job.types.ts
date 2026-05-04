export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
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
}
