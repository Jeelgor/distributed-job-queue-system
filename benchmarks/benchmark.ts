#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────
//  Distributed Job Queue — Performance Benchmark Suite
//
//  Measures 6 dimensions across configurable job scales:
//    1. Job Submission Throughput   (jobs/sec)
//    2. Job Processing Throughput   (jobs/min)
//    3. End-to-End Latency          (secondary)
//    4. Retry Recovery Rate         (%)
//    5. Dead Letter Queue Accuracy  (%)
//    6. Worker Scalability          (throughput vs concurrency)
//
//  Usage:
//    npx ts-node -P benchmarks/tsconfig.json benchmarks/benchmark.ts
//    npx ts-node -P benchmarks/tsconfig.json benchmarks/benchmark.ts --scale 100
//    npx ts-node -P benchmarks/tsconfig.json benchmarks/benchmark.ts --skip-scalability
//
//  Env vars for benchmark mode (recommended):
//    WORKER_DELAY_MS=0  WORKER_FAILURE_RATE=0
// ─────────────────────────────────────────────────────────

import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  MetricsCollector,
  type BenchmarkResult,
  type ScalabilityResult,
  type FullBenchmarkReport,
} from './metrics';
import { BENCHMARK_CONFIG } from './config';
import {
  submitJobsBatch,
  pollUntilSettled,
  queryJobsByType,
  getDlqEntries,
  cleanupBenchJobs,
  drainDlq,
  drainBenchQueue,
  closeConnections,
  checkRedisConnection,
  getRedis,
  sleep,
  formatNumber,
  formatDuration,
  formatRate,
  formatPct,
  formatMs,
  progressBar,
  printHeader,
  printSubHeader,
  type JobStats,
} from './utils';
import { generateReport, printSummary } from './report';

// ── CLI Arg Parsing ──────────────────────────────────────

interface CliArgs {
  scales: number[];
  skipScalability: boolean;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let scales: number[] = [...BENCHMARK_CONFIG.JOB_SCALES];
  let skipScalability = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--scale' && args[i + 1]) {
      scales = [parseInt(args[++i]!, 10)];
    } else if (arg === '--skip-scalability') {
      skipScalability = true;
    }
  }

  // Also check env
  const envScale = process.env['BENCHMARK_SCALE'];
  if (envScale) {
    scales = [parseInt(envScale, 10)];
  }

  return { scales, skipScalability };
}

// ── Scale Benchmark ──────────────────────────────────────

async function runScaleBenchmark(scale: number): Promise<BenchmarkResult> {
  const startedAt = new Date().toISOString();
  const collector = new MetricsCollector();
  const jobType = `${BENCHMARK_CONFIG.BENCH_JOB_TYPE_PREFIX}scale-${scale}`;
  const timeout = BENCHMARK_CONFIG.TIMEOUTS[scale] ?? 3_600_000;

  printHeader(`BENCHMARK: ${formatNumber(scale)} JOBS`);

  // ── Pre-clean ──────────────────────────────────────────
  await getRedis().flushdb();
  await cleanupBenchJobs(jobType);
  await drainDlq();

  // ── Test 1: Submission Throughput ──────────────────────
  printSubHeader('Test 1 · Job Submission Throughput');

  const submitStart = performance.now();
  const { successCount, errorCount, responseTimes } = await submitJobsBatch(
    scale,
    jobType,
    BENCHMARK_CONFIG.SUBMISSION_CONCURRENCY,
    (done, total) => {
      process.stdout.write(
        `\r    Submitting: ${progressBar(done, total)} ${formatNumber(done)}/${formatNumber(total)}`,
      );
    },
  );
  const submitDuration = performance.now() - submitStart;
  console.log('');

  collector.recordLatencies('api-response', responseTimes);
  // Free the array immediately — only percentiles are needed now
  responseTimes.length = 0;

  const submissionMetrics = {
    totalJobs: scale,
    durationMs: submitDuration,
    jobsPerSecond: successCount > 0 ? (successCount / submitDuration) * 1000 : 0,
    apiResponseLatency: collector.getPercentiles('api-response'),
    errors: errorCount,
  };

  console.log(`    ✓ Submitted ${formatNumber(successCount)} jobs in ${formatDuration(submitDuration)}`);
  console.log(`    ✓ Throughput: ${formatRate(submissionMetrics.jobsPerSecond, 'jobs/sec')}`);
  console.log(`    ✓ API p95: ${formatMs(submissionMetrics.apiResponseLatency.p95)} · p99: ${formatMs(submissionMetrics.apiResponseLatency.p99)}`);
  if (errorCount > 0) console.log(`    ⚠ Submission errors: ${errorCount}`);

  // ── Test 2: Processing Throughput ─────────────────────
  printSubHeader('Test 2 · Job Processing Throughput');

  const { durationMs: processDuration, finalStats, timedOut } = await pollUntilSettled(
    timeout,
    (stats: JobStats, elapsed: number) => {
      const total = stats.completed + stats.failed + stats.pending + stats.processing;
      const done = stats.completed + stats.failed;
      process.stdout.write(
        `\r    Processing: ${progressBar(done, total)} ` +
        `C:${formatNumber(stats.completed)} F:${formatNumber(stats.failed)} ` +
        `P:${formatNumber(stats.processing)} Q:${formatNumber(stats.pending)} ` +
        `[${formatDuration(elapsed)}]`,
      );
    },
  );
  console.log('');

  if (timedOut) console.log(`    ⚠ Processing timed out after ${formatDuration(processDuration)}`);

  const totalProcessed = finalStats.completed + finalStats.failed;
  const processingMetrics = {
    totalProcessed,
    durationMs: processDuration,
    jobsPerMinute: totalProcessed > 0 ? (totalProcessed / processDuration) * 60_000 : 0,
    completed: finalStats.completed,
    failed: finalStats.failed,
  };

  console.log(`    ✓ Processed ${formatNumber(totalProcessed)} jobs in ${formatDuration(processDuration)}`);
  console.log(`    ✓ Throughput: ${formatRate(processingMetrics.jobsPerMinute, 'jobs/min')}`);
  console.log(`    ✓ Completed: ${formatNumber(finalStats.completed)} · Failed: ${formatNumber(finalStats.failed)}`);

  // ── Tests 3 & 4: Latency + Retry (single pass) ────────
  printSubHeader('Test 3 · End-to-End Latency + Retry Analysis');

  const allJobs = await queryJobsByType(jobType);

  // Single-pass aggregation — zero intermediate arrays
  let _completedCount = 0;
  let _retriedCount = 0;
  let _retriedCompletedCount = 0;
  let _totalAttemptsRetried = 0;
  let _maxAttempts = 0;
  const _permanentlyFailedIds: string[] = [];

  for (const job of allJobs) {
    if (job.attempts > _maxAttempts) _maxAttempts = job.attempts;

    if (job.status === 'completed') {
      _completedCount++;
      const latMs = new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime();
      if (latMs >= 0) collector.recordLatency('e2e-latency', latMs);
    } else if (job.status === 'failed') {
      _permanentlyFailedIds.push(job.id);
    }

    if (job.attempts > 1) {
      _retriedCount++;
      _totalAttemptsRetried += job.attempts;
      if (job.status === 'completed') _retriedCompletedCount++;
    }
  }
  const _totalJobs = allJobs.length;
  // Release the large array for GC immediately
  allJobs.length = 0;

  const latencyPercentiles = collector.getPercentiles('e2e-latency');
  const latencyMetrics = { endToEnd: latencyPercentiles };

  console.log(`    ✓ Median: ${formatMs(latencyPercentiles.median)}`);
  console.log(`    ✓ P95: ${formatMs(latencyPercentiles.p95)} · P99: ${formatMs(latencyPercentiles.p99)}`);
  console.log(`    ✓ Sample size: ${formatNumber(latencyPercentiles.count)}`);

  const retryMetrics = {
    totalJobs: _totalJobs,
    completedJobs: _completedCount,
    retriedJobs: _retriedCount,
    retryRecoveryRate:
      _retriedCount > 0
        ? (_retriedCompletedCount / _retriedCount) * 100
        : 100,
    permanentlyFailed: _permanentlyFailedIds.length,
    avgAttemptsForRetried:
      _retriedCount > 0
        ? _totalAttemptsRetried / _retriedCount
        : 0,
    maxAttempts: _maxAttempts,
  };

  console.log(`    ✓ Recovery Rate: ${formatPct(retryMetrics.retryRecoveryRate)}`);
  console.log(`    ✓ Retried: ${formatNumber(_retriedCount)} → Recovered: ${formatNumber(_retriedCompletedCount)}`);
  console.log(`    ✓ Permanently Failed: ${formatNumber(_permanentlyFailedIds.length)}`);
  if (_retriedCount > 0) {
    console.log(`    ✓ Avg attempts (retried jobs): ${retryMetrics.avgAttemptsForRetried.toFixed(1)}`);
  }

  // ── Test 5: DLQ Accuracy ──────────────────────────────
  printSubHeader('Test 4 · Dead Letter Queue Accuracy');

  const redisUp = await checkRedisConnection();
  let dlqMetrics;

  if (!redisUp) {
    console.log('    ⚠ Redis not available — DLQ accuracy skipped');
    dlqMetrics = {
      expectedInDlq: _permanentlyFailedIds.length,
      actualInDlq: 0,
      matched: 0,
      accuracy: 0,
      missingFromDlq: [] as string[],
    };
  } else {
    const dlqEntries = await getDlqEntries();
    const failedIdSet = new Set(_permanentlyFailedIds);
    const dlqJobIds = new Set(dlqEntries.map((e) => e.jobId));

    const matchedInDlq = [...failedIdSet].filter((id) => dlqJobIds.has(id));
    const missingFromDlq = [...failedIdSet].filter((id) => !dlqJobIds.has(id));

    dlqMetrics = {
      expectedInDlq: _permanentlyFailedIds.length,
      actualInDlq: dlqEntries.length,
      matched: matchedInDlq.length,
      accuracy:
        _permanentlyFailedIds.length > 0
          ? (matchedInDlq.length / _permanentlyFailedIds.length) * 100
          : 100,
      missingFromDlq,
    };

    console.log(`    ✓ DLQ Accuracy: ${formatPct(dlqMetrics.accuracy)}`);
    console.log(`    ✓ Expected: ${formatNumber(dlqMetrics.expectedInDlq)} · Found: ${formatNumber(dlqMetrics.matched)}`);
    if (dlqMetrics.missingFromDlq.length > 0) {
      console.log(`    ⚠ Missing from DLQ: ${dlqMetrics.missingFromDlq.length} job(s)`);
    }
  }

  // ── Cleanup ───────────────────────────────────────────
  printSubHeader('Cleanup');

  const deleted = await cleanupBenchJobs(jobType);
  await drainDlq();
  console.log(`    ✓ Removed ${formatNumber(deleted)} benchmark jobs from DB`);

  return {
    scale,
    startedAt,
    completedAt: new Date().toISOString(),
    submission: submissionMetrics,
    processing: processingMetrics,
    latency: latencyMetrics,
    retry: retryMetrics,
    dlq: dlqMetrics,
  };
}

// ── Scalability Benchmark ────────────────────────────────

async function runScalabilityBenchmark(): Promise<ScalabilityResult[]> {
  printHeader('BENCHMARK: WORKER SCALABILITY');
  console.log(`    Queue: job-queue-bench (isolated)`);
  console.log(`    Jobs per level: ${formatNumber(BENCHMARK_CONFIG.SCALABILITY_JOB_COUNT)}`);

  const results: ScalabilityResult[] = [];
  const jobCount = BENCHMARK_CONFIG.SCALABILITY_JOB_COUNT;
  let baselineRate = 0;

  // Shared Redis for the benchmark queue
  const queueRedis = new Redis({
    host: BENCHMARK_CONFIG.REDIS_HOST,
    port: BENCHMARK_CONFIG.REDIS_PORT,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const benchQueue = new Queue('job-queue-bench', { connection: queueRedis });

  for (const concurrency of BENCHMARK_CONFIG.SCALABILITY_CONCURRENCY_LEVELS) {
    printSubHeader(`Concurrency: ${concurrency}`);

    // Drain previous jobs
    try { await benchQueue.drain(); } catch { /* empty queue */ }

    // Spawn a dedicated worker with this concurrency
    const workerRedis = new Redis({
      host: BENCHMARK_CONFIG.REDIS_HOST,
      port: BENCHMARK_CONFIG.REDIS_PORT,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    let processedCount = 0;
    const worker = new Worker(
      'job-queue-bench',
      async () => {
        // Minimal processing — measuring queue infrastructure throughput
        processedCount++;
      },
      { connection: workerRedis, concurrency },
    );

    // Give the worker time to register
    await sleep(500);

    // Enqueue jobs in bulk
    const bulkData = Array.from({ length: jobCount }, (_, i) => ({
      name: 'bench-scalability',
      data: { index: i },
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    }));
    await benchQueue.addBulk(bulkData);

    // Wait for all jobs to complete
    const start = Date.now();
    const scaleTimeout = 120_000; // 2 minutes max per level
    while (processedCount < jobCount && Date.now() - start < scaleTimeout) {
      await sleep(50);
    }
    const duration = Date.now() - start;

    const jobsPerMinute = duration > 0 ? (processedCount / duration) * 60_000 : 0;
    if (baselineRate === 0) baselineRate = jobsPerMinute;
    const scalingFactor = baselineRate > 0 ? jobsPerMinute / baselineRate : 1;

    results.push({
      concurrency,
      jobCount: processedCount,
      durationMs: duration,
      jobsPerMinute,
      scalingFactor,
    });

    console.log(`    ✓ ${formatNumber(processedCount)} jobs in ${formatDuration(duration)}`);
    console.log(`    ✓ ${formatRate(jobsPerMinute, 'jobs/min')} (${scalingFactor.toFixed(1)}x baseline)`);

    // Tear down worker
    await worker.close();
    workerRedis.disconnect();
  }

  // Final cleanup
  try { await benchQueue.drain(); } catch { /* ignore */ }
  await benchQueue.close();
  queueRedis.disconnect();

  return results;
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const { scales, skipScalability } = parseCliArgs();

  // Probe Redis before printing banner
  const redisOk = await checkRedisConnection();

  const banner = [
    '',
    '═'.repeat(60),
    '  DISTRIBUTED JOB QUEUE — PERFORMANCE BENCHMARK SUITE',
    '═'.repeat(60),
    `  Started:   ${new Date().toISOString()}`,
    `  Scales:    ${scales.map(formatNumber).join(' → ')}`,
    `  API:       ${BENCHMARK_CONFIG.API_BASE_URL}`,
    `  Redis:     ${redisOk ? `✓ ${BENCHMARK_CONFIG.REDIS_HOST}:${BENCHMARK_CONFIG.REDIS_PORT}` : '✖ unavailable (DLQ + scalability tests will be skipped)'}`,
    `  Delay:     ${process.env['WORKER_DELAY_MS'] ?? '3000-5000 (default)'}ms`,
    `  Failures:  ${process.env['WORKER_FAILURE_RATE'] ?? '0.2 (default)'}`,
    '═'.repeat(60),
  ];
  console.log(banner.join('\n'));

  const benchmarkResults: BenchmarkResult[] = [];
  let scalabilityResults: ScalabilityResult[] = [];

  try {
    // Run scale benchmarks
    for (const scale of scales) {
      const result = await runScaleBenchmark(scale);
      benchmarkResults.push(result);
    }

    // Run scalability benchmark (requires Redis)
    if (!skipScalability && redisOk) {
      scalabilityResults = await runScalabilityBenchmark();
    } else if (!skipScalability && !redisOk) {
      console.log('\n  ⚠ Scalability test skipped — Redis not available');
    }

    // Build report
    const report: FullBenchmarkReport = {
      environment: {
        nodeVersion: process.version,
        platform: `${process.platform} ${process.arch}`,
        workerDelayMs: process.env['WORKER_DELAY_MS'] ?? '3000-5000 (default)',
        workerFailureRate: process.env['WORKER_FAILURE_RATE'] ?? '0.2 (default)',
        workerConcurrency: process.env['WORKER_CONCURRENCY'] ?? '5 (default)',
        apiBaseUrl: BENCHMARK_CONFIG.API_BASE_URL,
        timestamp: new Date().toISOString(),
      },
      results: benchmarkResults,
      scalability: scalabilityResults,
    };

    // Print console summary
    printSummary(report);

    // Save markdown report
    const reportPath = await generateReport(report);
    console.log(`\n  📄 Full report saved: ${reportPath}`);
  } catch (err) {
    console.error('\n  ❌ Benchmark failed:', err);
    process.exit(1);
  } finally {
    await closeConnections();
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  BENCHMARK COMPLETE');
  console.log('═'.repeat(60) + '\n');

  process.exit(0);
}

main();
