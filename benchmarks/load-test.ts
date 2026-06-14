#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────
//  Distributed Job Queue — Sustained Load Test
//
//  Submits jobs at a configurable rate with optional
//  ramp-up, showing a real-time dashboard.
//
//  Usage:
//    npx ts-node -P benchmarks/tsconfig.json benchmarks/load-test.ts
//    npx ts-node -P benchmarks/tsconfig.json benchmarks/load-test.ts --jobs 10000 --rate 50 --ramp-up 10
//
//  Options:
//    --jobs     Total jobs to submit         (default: 1000)
//    --rate     Target submission rate / sec  (default: 20)
//    --ramp-up  Ramp-up duration in seconds   (default: 5)
// ─────────────────────────────────────────────────────────

import 'dotenv/config';
import { BENCHMARK_CONFIG } from './config';
import {
  submitJob,
  getStats,
  cleanupBenchJobs,
  drainDlq,
  closeConnections,
  sleep,
  formatNumber,
  formatDuration,
  formatRate,
  formatPct,
  progressBar,
  type JobStats,
} from './utils';

// ── Config ───────────────────────────────────────────────

interface LoadTestConfig {
  totalJobs: number;
  targetRate: number;
  rampUpSeconds: number;
}

function parseArgs(): LoadTestConfig {
  const args = process.argv.slice(2);
  const cfg: LoadTestConfig = {
    totalJobs: 1_000,
    targetRate: 20,
    rampUpSeconds: 5,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--jobs'    && args[i + 1]) cfg.totalJobs     = parseInt(args[++i]!, 10);
    if (a === '--rate'    && args[i + 1]) cfg.targetRate     = parseInt(args[++i]!, 10);
    if (a === '--ramp-up' && args[i + 1]) cfg.rampUpSeconds  = parseInt(args[++i]!, 10);
  }

  return cfg;
}

// ── Dashboard ────────────────────────────────────────────

function renderDashboard(
  cfg: LoadTestConfig,
  submitted: number,
  stats: JobStats,
  startTime: number,
  errors: number,
  phase: 'submitting' | 'draining',
): void {
  const elapsed = Date.now() - startTime;
  const elapsedStr = formatDuration(elapsed);
  const totalDone = stats.completed + stats.failed;
  const submitRate = elapsed > 0 ? (submitted / elapsed) * 1000 : 0;
  const processRate = elapsed > 0 ? (totalDone / elapsed) * 1000 : 0;
  const successRate = totalDone > 0 ? (stats.completed / totalDone) * 100 : 100;

  // Move cursor to top-left and clear screen
  process.stdout.write('\x1B[2J\x1B[H');

  const w = 58;
  const line = '═'.repeat(w);
  const thin = '─'.repeat(w);

  const phaseLabel = phase === 'submitting' ? '▶ SUBMITTING' : '◼ DRAINING';

  console.log(`  ${line}`);
  console.log(`   LOAD TEST  │ ${elapsedStr.padEnd(12)} │ ${phaseLabel.padEnd(16)} │ Target: ${formatNumber(cfg.totalJobs)}`);
  console.log(`  ${line}`);
  console.log(`   Submitted:   ${formatNumber(submitted).padStart(9)}  │  Submit Rate:  ${formatRate(submitRate, '/s')}`);
  console.log(`   Completed:   ${formatNumber(stats.completed).padStart(9)}  │  Process Rate: ${formatRate(processRate, '/s')}`);
  console.log(`   Processing:  ${formatNumber(stats.processing).padStart(9)}  │  Success Rate: ${formatPct(successRate)}`);
  console.log(`   Pending:     ${formatNumber(stats.pending).padStart(9)}  │  Errors:       ${formatNumber(errors)}`);
  console.log(`   Failed:      ${formatNumber(stats.failed).padStart(9)}  │`);
  console.log(`  ${thin}`);
  console.log(`   Submit:  ${progressBar(submitted, cfg.totalJobs, 40)}`);
  console.log(`   Done:    ${progressBar(totalDone, cfg.totalJobs, 40)}`);
  console.log(`  ${line}`);
}

// ── Main ─────────────────────────────────────────────────

async function runLoadTest(): Promise<void> {
  const cfg = parseArgs();
  const jobType = `${BENCHMARK_CONFIG.BENCH_JOB_TYPE_PREFIX}loadtest`;
  const startTime = Date.now();
  let submitted = 0;
  let errors = 0;
  let shuttingDown = false;

  console.log('');
  console.log('  Starting load test...');
  console.log(`  Jobs: ${formatNumber(cfg.totalJobs)} │ Rate: ${cfg.targetRate}/sec │ Ramp-up: ${cfg.rampUpSeconds}s`);
  console.log('');

  // Graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
  });

  // Background stats poller
  let latestStats: JobStats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  const statsTimer = setInterval(async () => {
    try { latestStats = await getStats(); } catch { /* ignore */ }
  }, 1_000);

  // Dashboard renderer
  const dashTimer = setInterval(() => {
    const phase = submitted < cfg.totalJobs ? 'submitting' : 'draining';
    renderDashboard(cfg, submitted, latestStats, startTime, errors, phase);
  }, 500);

  try {
    // ── Submission phase ─────────────────────────────────
    while (submitted < cfg.totalJobs && !shuttingDown) {
      const elapsedSec = (Date.now() - startTime) / 1000;

      // Linear ramp-up then steady state
      let currentRate: number;
      if (elapsedSec < cfg.rampUpSeconds && cfg.rampUpSeconds > 0) {
        currentRate = Math.max(1, (elapsedSec / cfg.rampUpSeconds) * cfg.targetRate);
      } else {
        currentRate = cfg.targetRate;
      }

      // How many should we have submitted by now?
      let expectedTotal: number;
      if (elapsedSec < cfg.rampUpSeconds && cfg.rampUpSeconds > 0) {
        // Area under the ramp triangle
        expectedTotal = (currentRate * elapsedSec) / 2;
      } else {
        const rampArea = (cfg.targetRate * cfg.rampUpSeconds) / 2;
        const steadyArea = cfg.targetRate * (elapsedSec - cfg.rampUpSeconds);
        expectedTotal = rampArea + steadyArea;
      }

      const deficit = Math.min(
        Math.max(0, Math.ceil(expectedTotal) - submitted),
        cfg.totalJobs - submitted,
        Math.ceil(currentRate * 2), // cap burst size
      );

      if (deficit > 0) {
        const batch = Array.from({ length: deficit }, () =>
          submitJob(jobType, { ts: Date.now() })
            .then(() => { submitted++; })
            .catch(() => { errors++; submitted++; }),
        );
        await Promise.all(batch);
      }

      await sleep(50);
    }

    // ── Drain phase — wait for processing to finish ──────
    const drainTimeout = 600_000; // 10 min
    const drainStart = Date.now();
    while (Date.now() - drainStart < drainTimeout && !shuttingDown) {
      try { latestStats = await getStats(); } catch { /* ignore */ }
      if (latestStats.pending === 0 && latestStats.processing === 0) break;
      await sleep(1_000);
    }
  } finally {
    clearInterval(statsTimer);
    clearInterval(dashTimer);
  }

  // ── Final summary ──────────────────────────────────────
  const totalDuration = Date.now() - startTime;
  const totalDone = latestStats.completed + latestStats.failed;

  process.stdout.write('\x1B[2J\x1B[H');
  const line = '═'.repeat(58);

  console.log(`\n  ${line}`);
  console.log('   LOAD TEST COMPLETE');
  console.log(`  ${line}`);
  console.log(`   Duration:      ${formatDuration(totalDuration)}`);
  console.log(`   Submitted:     ${formatNumber(submitted)}`);
  console.log(`   Completed:     ${formatNumber(latestStats.completed)}`);
  console.log(`   Failed:        ${formatNumber(latestStats.failed)}`);
  console.log(`   Errors:        ${formatNumber(errors)}`);
  console.log(`   Submit Rate:   ${formatRate((submitted / totalDuration) * 1000, 'jobs/sec')}`);
  console.log(`   Process Rate:  ${formatRate((totalDone / totalDuration) * 1000, 'jobs/sec')}`);
  console.log(`   Success Rate:  ${formatPct(totalDone > 0 ? (latestStats.completed / totalDone) * 100 : 100)}`);
  console.log(`  ${line}`);

  // Cleanup
  console.log('\n  Cleaning up benchmark data...');
  const cleaned = await cleanupBenchJobs(jobType);
  await drainDlq();
  console.log(`  ✓ Removed ${formatNumber(cleaned)} load test jobs from DB`);

  await closeConnections();
  console.log('  ✓ Done.\n');

  process.exit(0);
}

runLoadTest();
