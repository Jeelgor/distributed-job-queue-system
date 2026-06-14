import Redis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env['REDIS_URL'];
const REDIS_HOST = process.env['REDIS_HOST'] ?? '127.0.0.1';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
const REDIS_PASSWORD = process.env['REDIS_PASSWORD'] || undefined;

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // required for BullMQ compatibility
      enableReadyCheck: false,
    })
  : new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

const logTarget = REDIS_URL ? 'REDIS_URL' : `${REDIS_HOST}:${REDIS_PORT}`;

redis.on('connect', () => {
  logger.info({ target: logTarget }, 'Redis connected');
});

redis.on('error', (err) => {
  logger.error({ err, target: logTarget }, 'Redis connection error');
});

