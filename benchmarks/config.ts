// ─────────────────────────────────────────────────────────
//  Benchmark Configuration
// ─────────────────────────────────────────────────────────

export const BENCHMARK_CONFIG = {
  /** Base URL of the running Fastify API server */
  API_BASE_URL: process.env['BENCH_API_URL'] ?? 'http://127.0.0.1:3000',

  /** Job scales to benchmark — each scale runs the full test suite */
  JOB_SCALES: [100, 1_000, 10_000, 50_000, 100_000] as const,

  /** Max concurrent HTTP requests during job submission */
  SUBMISSION_CONCURRENCY: 50,

  /** Polling interval when waiting for jobs to settle (ms) */
  POLL_INTERVAL_MS: 500,

  /** Worker concurrency levels for the scalability benchmark */
  SCALABILITY_CONCURRENCY_LEVELS: [1, 5, 10, 25, 50] as const,

  /** Number of jobs per concurrency level in scalability test */
  SCALABILITY_JOB_COUNT: 500,

  /** Prefix for all benchmark job types — used for safe cleanup */
  BENCH_JOB_TYPE_PREFIX: 'bench-',

  /** Timeout per scale (ms) — generous limits to avoid false failures */
  TIMEOUTS: {
    100: 120_000,        // 2 min
    1_000: 300_000,      // 5 min
    10_000: 900_000,     // 15 min
    50_000: 2_400_000,   // 40 min
    100_000: 3_600_000,  // 60 min
  } as Record<number, number>,

  /** Redis connection for direct DLQ inspection */
  REDIS_HOST: process.env['REDIS_HOST'] ?? '127.0.0.1',
  REDIS_PORT: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),

  /** Directory for saved benchmark reports */
  RESULTS_DIR: 'benchmarks/results',
};

export type Scale = (typeof BENCHMARK_CONFIG.JOB_SCALES)[number];
