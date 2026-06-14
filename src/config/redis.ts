import Redis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_HOST = process.env['REDIS_HOST'] ?? '127.0.0.1';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);

export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null, // required for BullMQ compatibility
  enableReadyCheck: false,
});

redis.on('connect', () => {
  logger.info({ host: REDIS_HOST, port: REDIS_PORT }, 'Redis connected');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});
