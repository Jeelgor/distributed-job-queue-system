// ─────────────────────────────────────────────────────────
//  Metrics Collector & Result Types
// ─────────────────────────────────────────────────────────

// ── Percentile Result ────────────────────────────────────

export interface PercentileResult {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
  count: number;
  total: number;
}

// ── Benchmark Result (per scale) ─────────────────────────

export interface SubmissionMetrics {
  totalJobs: number;
  durationMs: number;
  jobsPerSecond: number;
  apiResponseLatency: PercentileResult;
  errors: number;
}

export interface ProcessingMetrics {
  totalProcessed: number;
  durationMs: number;
  jobsPerMinute: number;
  completed: number;
  failed: number;
}

export interface LatencyMetrics {
  endToEnd: PercentileResult;
}

export interface RetryMetrics {
  totalJobs: number;
  completedJobs: number;
  retriedJobs: number;
  retryRecoveryRate: number;
  permanentlyFailed: number;
  avgAttemptsForRetried: number;
  maxAttempts: number;
}

export interface DlqMetrics {
  expectedInDlq: number;
  actualInDlq: number;
  matched: number;
  accuracy: number;
  missingFromDlq: string[];
}

export interface BenchmarkResult {
  scale: number;
  startedAt: string;
  completedAt: string;
  submission: SubmissionMetrics;
  processing: ProcessingMetrics;
  latency: LatencyMetrics;
  retry: RetryMetrics;
  dlq: DlqMetrics;
}

// ── Scalability Result ───────────────────────────────────

export interface ScalabilityResult {
  concurrency: number;
  jobCount: number;
  durationMs: number;
  jobsPerMinute: number;
  scalingFactor: number;
}

// ── Full Report ──────────────────────────────────────────

export interface FullBenchmarkReport {
  environment: {
    nodeVersion: string;
    platform: string;
    workerDelayMs: string;
    workerFailureRate: string;
    workerConcurrency: string;
    apiBaseUrl: string;
    timestamp: string;
  };
  results: BenchmarkResult[];
  scalability: ScalabilityResult[];
}

// ── Metrics Collector ────────────────────────────────────

export class MetricsCollector {
  private latencyBuckets: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();

  /** Record a single latency measurement into a named bucket */
  recordLatency(bucket: string, ms: number): void {
    if (!this.latencyBuckets.has(bucket)) {
      this.latencyBuckets.set(bucket, []);
    }
    this.latencyBuckets.get(bucket)!.push(ms);
  }

  /** Bulk-record latency values */
  recordLatencies(bucket: string, values: number[]): void {
    if (!this.latencyBuckets.has(bucket)) {
      this.latencyBuckets.set(bucket, []);
    }
    this.latencyBuckets.get(bucket)!.push(...values);
  }

  /** Increment a named counter */
  increment(counter: string, n: number = 1): void {
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + n);
  }

  /** Get current counter value */
  getCount(counter: string): number {
    return this.counters.get(counter) ?? 0;
  }

  /** Get number of recorded latencies in a bucket */
  getLatencyCount(bucket: string): number {
    return this.latencyBuckets.get(bucket)?.length ?? 0;
  }

  /** Calculate percentiles for a latency bucket */
  getPercentiles(bucket: string): PercentileResult {
    const values = this.latencyBuckets.get(bucket);
    if (!values || values.length === 0) {
      return { min: 0, max: 0, avg: 0, median: 0, p95: 0, p99: 0, count: 0, total: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);

    return {
      min: sorted[0]!,
      max: sorted[n - 1]!,
      avg: sum / n,
      median: interpolatedPercentile(sorted, 0.5),
      p95: interpolatedPercentile(sorted, 0.95),
      p99: interpolatedPercentile(sorted, 0.99),
      count: n,
      total: sum,
    };
  }

  /** Clear all collected data */
  reset(): void {
    this.latencyBuckets.clear();
    this.counters.clear();
  }
}

// ── Interpolated Percentile ──────────────────────────────

function interpolatedPercentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0]!;

  const index = p * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedArr[lower]!;

  const fraction = index - lower;
  return sortedArr[lower]! + fraction * (sortedArr[upper]! - sortedArr[lower]!);
}
