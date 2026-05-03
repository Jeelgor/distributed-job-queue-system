export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface Job {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobInput {
  name: string;
  payload: Record<string, unknown>;
}

export interface UpdateJobInput {
  status?: JobStatus;
}
