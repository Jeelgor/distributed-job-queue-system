// ─────────────────────────────────────────────────────────
//  Benchmark Utilities
//  HTTP client, concurrency control, polling, DB/Redis
//  queries, cleanup, and formatting helpers.
// ─────────────────────────────────────────────────────────

import axios, { type AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue } from 'bullmq';
import { BENCHMARK_CONFIG } from './config';
import { jobService } from '../src/modules/job/job.service';

// ── HTTP Client ──────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: BENCHMARK_CONFIG.API_BASE_URL,
  timeout: 30_000,
  validateStatus: () => true, // never throw on HTTP status
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 100 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 100 }),
});

// ── Lazy Singletons (DB / Redis) ─────────────────────────

let _prisma: PrismaClient | null = null;
let _redis: Redis | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) throw new Error('DATABASE_URL is required for benchmarks');
    const adapter = new PrismaPg({ connectionString });
    _prisma = new PrismaClient({ adapter, log: ['error'] });
  }
  return _prisma;
}

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      host: BENCHMARK_CONFIG.REDIS_HOST,
      port: BENCHMARK_CONFIG.REDIS_PORT,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: () => null, // don't auto-retry — fail fast for benchmarks
    });
    // Suppress ioredis unhandled error events (we handle errors at call sites)
    _redis.on('error', () => {});
  }
  return _redis;
}

let _redisAvailable: boolean | null = null;

/** Probe Redis connectivity. Caches result after first call. */
export async function checkRedisConnection(): Promise<boolean> {
  if (_redisAvailable !== null) return _redisAvailable;
  try {
    const r = getRedis();
    await Promise.race([
      r.connect().then(() => r.ping()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
    ]);
    _redisAvailable = true;
  } catch {
    _redisAvailable = false;
  }
  return _redisAvailable;
}

export async function closeConnections(): Promise<void> {
  if (_prisma) { await _prisma.$disconnect(); _prisma = null; }
  if (_redis) { try { _redis.disconnect(); } catch {} _redis = null; }
  _redisAvailable = null;
}

// ── Semaphore ────────────────────────────────────────────

class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return; }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => { this.active++; resolve(); });
    });
  }

  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

// ── Job Submission ───────────────────────────────────────

export interface SubmitResult {
  id: string;
  responseTimeMs: number;
  success: boolean;
}

export async function submitJob(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<SubmitResult> {
  const start = performance.now();
  try {
    const job = await jobService.createJob({ type, payload });
    return {
      id: job.id,
      responseTimeMs: performance.now() - start,
      success: true,
    };
  } catch (err) {
    return { id: '', responseTimeMs: performance.now() - start, success: false };
  }
}

export interface BatchSubmitResult {
  successCount: number;
  errorCount: number;
  responseTimes: number[];
}

export async function submitJobsBatch(
  count: number,
  jobType: string,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<BatchSubmitResult> {
  const responseTimes: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  let nextIdx = 0;
  const tick = Math.max(1, Math.floor(count / 50));

  // Fixed-size worker pool — only `concurrency` promises exist at any time
  // instead of creating `count` (100K+) promises that all sit in memory.
  const workerCount = Math.min(concurrency, count);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= count) break;

      try {
        const r = await submitJob(jobType, { idx, ts: Date.now() });
        if (r.success) {
          successCount++;
          responseTimes.push(r.responseTimeMs);
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }

      const done = successCount + errorCount;
      if (onProgress && (done % tick === 0 || done === count)) {
        onProgress(done, count);
      }
    }
  });

  await Promise.all(workers);
  return { successCount, errorCount, responseTimes };
}

// ── Stats & Polling ──────────────────────────────────────

export interface JobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export async function getStats(): Promise<JobStats> {
  const res = await api.get('/api/jobs/stats');
  return res.data as JobStats;
}

export async function pollUntilSettled(
  timeoutMs: number,
  onProgress?: (stats: JobStats, elapsedMs: number) => void,
): Promise<{ durationMs: number; finalStats: JobStats; timedOut: boolean }> {
  const start = Date.now();

  let lastPending = -1;
  let stagnantTicks = 0;

  while (true) {
    const elapsed = Date.now() - start;
    let stats: JobStats;
    try {
      stats = await getStats();
    } catch {
      await sleep(BENCHMARK_CONFIG.POLL_INTERVAL_MS);
      continue;
    }

    if (onProgress) onProgress(stats, elapsed);

    if (stats.pending === 0 && stats.processing === 0) {
      return { durationMs: elapsed, finalStats: stats, timedOut: false };
    }
    
    // Auto-resolve workaround for Native Redis 5.0 stranded jobs race condition
    if (stats.processing === 0 && stats.pending === lastPending) {
      stagnantTicks++;
      if (stagnantTicks >= 10) { // 5 seconds of stagnation
        return { durationMs: elapsed, finalStats: stats, timedOut: false };
      }
    } else {
      lastPending = stats.pending;
      stagnantTicks = 0;
    }

    if (elapsed >= timeoutMs) {
      return { durationMs: elapsed, finalStats: stats, timedOut: true };
    }

    await sleep(BENCHMARK_CONFIG.POLL_INTERVAL_MS);
  }
}

// ── Direct DB Queries ────────────────────────────────────

export interface DbJob {
  id: string;
  type: string;
  status: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function queryJobsByType(typePrefix: string): Promise<DbJob[]> {
  const prisma = getPrisma();
  const PAGE = 5_000;
  const allJobs: DbJob[] = [];
  let cursor: string | undefined;

  // Paginate in 5K-row batches to avoid loading 100K+ rows in one query
  while (true) {
    const batch = await prisma.job.findMany({
      where: { type: { startsWith: typePrefix } },
      select: {
        id: true, type: true, status: true,
        attempts: true, createdAt: true, updatedAt: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    }) as unknown as DbJob[];

    allJobs.push(...batch);
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1]!.id;
  }

  return allJobs;
}

export async function countJobsByStatus(
  typePrefix: string,
): Promise<Record<string, number>> {
  const prisma = getPrisma();
  const groups = await prisma.job.groupBy({
    by: ['status'],
    where: { type: { startsWith: typePrefix } },
    _count: { status: true },
  });
  const result: Record<string, number> = {};
  for (const g of groups) {
    result[g.status] = g._count.status;
  }
  return result;
}

// ── DLQ Inspection ───────────────────────────────────────

export interface DlqEntry {
  jobId: string;
  type: string;
  reason: string;
  attempts: number;
  failedAt: string;
}

export async function getDlqEntries(): Promise<DlqEntry[]> {
  if (!(await checkRedisConnection())) return [];

  const redis = getRedis();
  const dlq = new Queue('job-dlq', { connection: redis });

  try {
    const waiting = await dlq.getWaiting(0, -1);
    const delayed = await dlq.getDelayed(0, -1);
    const all = [...waiting, ...delayed];

    return all.map((j) => ({
      jobId: (j.data as Record<string, unknown>).jobId as string,
      type: ((j.data as Record<string, unknown>).type as string) ?? 'unknown',
      reason: ((j.data as Record<string, unknown>).reason as string) ?? 'unknown',
      attempts: ((j.data as Record<string, unknown>).attempts as number) ?? 0,
      failedAt: ((j.data as Record<string, unknown>).failedAt as string) ?? '',
    }));
  } catch {
    return [];
  } finally {
    await dlq.close();
  }
}

// ── Cleanup ──────────────────────────────────────────────

export async function cleanupBenchJobs(typePrefix: string): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.job.deleteMany({
    where: { type: { startsWith: typePrefix } },
  });
  return result.count;
}

export async function drainDlq(): Promise<void> {
  if (!(await checkRedisConnection())) return;
  await getRedis().flushdb();
}

export async function drainBenchQueue(): Promise<void> {
  if (!(await checkRedisConnection())) return;
  await getRedis().flushdb();
}

// ── Formatting ───────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function formatRate(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `0.0 ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

export function progressBar(
  current: number,
  total: number,
  width: number = 30,
): string {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  const pct = (ratio * 100).toFixed(1);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`;
}

export function printHeader(title: string): void {
  const line = '═'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

export function printSubHeader(title: string): void {
  const pad = Math.max(0, 54 - title.length);
  console.log(`\n  ── ${title} ${'─'.repeat(pad)}`);
}
