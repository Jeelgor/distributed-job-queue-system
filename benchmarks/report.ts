// ─────────────────────────────────────────────────────────
//  Benchmark Report Generator
//  Console ASCII summary + Markdown file output.
// ─────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { BENCHMARK_CONFIG } from './config';
import type {
  FullBenchmarkReport,
  BenchmarkResult,
  ScalabilityResult,
  PercentileResult,
} from './metrics';

// ── Inline formatters (avoid heavy utils import) ─────────

function fmtN(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtRate(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  return v.toFixed(1);
}

function padR(s: string, w: number): string { return s.padEnd(w); }
function padL(s: string, w: number): string { return s.padStart(w); }

// ── Console Summary ──────────────────────────────────────

export function printSummary(report: FullBenchmarkReport): void {
  const line = '═'.repeat(60);

  console.log(`\n${line}`);
  console.log('  BENCHMARK RESULTS — SUMMARY');
  console.log(line);

  // Environment
  console.log(`\n  Environment:`);
  console.log(`    Node.js:          ${report.environment.nodeVersion}`);
  console.log(`    Platform:         ${report.environment.platform}`);
  console.log(`    Worker Delay:     ${report.environment.workerDelayMs}`);
  console.log(`    Failure Rate:     ${report.environment.workerFailureRate}`);
  console.log(`    Concurrency:      ${report.environment.workerConcurrency}`);
  console.log(`    API:              ${report.environment.apiBaseUrl}`);

  // Primary metrics table
  if (report.results.length > 0) {
    console.log(`\n  ── Primary Metrics ${'─'.repeat(39)}`);
    console.log('');
    console.log(
      `  ${padR('Scale', 10)}` +
      `${padL('Submit/s', 10)}` +
      `${padL('Process/min', 13)}` +
      `${padL('Recovery%', 11)}` +
      `${padL('DLQ Acc%', 10)}` +
      `${padL('Duration', 10)}`,
    );
    console.log(`  ${'─'.repeat(64)}`);

    for (const r of report.results) {
      console.log(
        `  ${padR(fmtN(r.scale), 10)}` +
        `${padL(fmtRate(r.submission.jobsPerSecond), 10)}` +
        `${padL(fmtRate(r.processing.jobsPerMinute), 13)}` +
        `${padL(fmtPct(r.retry.retryRecoveryRate), 11)}` +
        `${padL(fmtPct(r.dlq.accuracy), 10)}` +
        `${padL(fmtDur(r.processing.durationMs), 10)}`,
      );
    }
  }

  // Secondary metrics (latency)
  if (report.results.length > 0) {
    console.log(`\n  ── Secondary Metrics (Latency) ${'─'.repeat(27)}`);
    console.log('');
    console.log(
      `  ${padR('Scale', 10)}` +
      `${padL('Median', 10)}` +
      `${padL('P95', 10)}` +
      `${padL('P99', 10)}` +
      `${padL('API P95', 10)}` +
      `${padL('API P99', 10)}`,
    );
    console.log(`  ${'─'.repeat(60)}`);

    for (const r of report.results) {
      console.log(
        `  ${padR(fmtN(r.scale), 10)}` +
        `${padL(fmtMs(r.latency.endToEnd.median), 10)}` +
        `${padL(fmtMs(r.latency.endToEnd.p95), 10)}` +
        `${padL(fmtMs(r.latency.endToEnd.p99), 10)}` +
        `${padL(fmtMs(r.submission.apiResponseLatency.p95), 10)}` +
        `${padL(fmtMs(r.submission.apiResponseLatency.p99), 10)}`,
      );
    }
  }

  // Scalability table
  if (report.scalability.length > 0) {
    console.log(`\n  ── Worker Scalability ${'─'.repeat(36)}`);
    console.log('');
    console.log(
      `  ${padR('Workers', 10)}` +
      `${padL('Jobs/min', 12)}` +
      `${padL('Duration', 10)}` +
      `${padL('Scale', 8)}`,
    );
    console.log(`  ${'─'.repeat(40)}`);

    for (const s of report.scalability) {
      console.log(
        `  ${padR(String(s.concurrency), 10)}` +
        `${padL(fmtRate(s.jobsPerMinute), 12)}` +
        `${padL(fmtDur(s.durationMs), 10)}` +
        `${padL(`${s.scalingFactor.toFixed(1)}x`, 8)}`,
      );
    }
  }

  console.log('');
}

// ── Markdown Report ──────────────────────────────────────

function percentileTable(label: string, p: PercentileResult): string {
  return [
    `| Metric | ${label} |`,
    '|--------|--------|',
    `| Min | ${fmtMs(p.min)} |`,
    `| Median | ${fmtMs(p.median)} |`,
    `| Avg | ${fmtMs(p.avg)} |`,
    `| P95 | ${fmtMs(p.p95)} |`,
    `| P99 | ${fmtMs(p.p99)} |`,
    `| Max | ${fmtMs(p.max)} |`,
    `| Count | ${fmtN(p.count)} |`,
  ].join('\n');
}

function scaleSection(r: BenchmarkResult): string {
  const lines: string[] = [];

  lines.push(`### Scale: ${fmtN(r.scale)} Jobs`);
  lines.push('');
  lines.push(`- **Started**: ${r.startedAt}`);
  lines.push(`- **Completed**: ${r.completedAt}`);
  lines.push('');

  // Submission
  lines.push('#### Job Submission Throughput');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Submitted | ${fmtN(r.submission.totalJobs)} |`);
  lines.push(`| Duration | ${fmtDur(r.submission.durationMs)} |`);
  lines.push(`| **Throughput** | **${fmtRate(r.submission.jobsPerSecond)} jobs/sec** |`);
  lines.push(`| Errors | ${fmtN(r.submission.errors)} |`);
  lines.push('');
  lines.push('**API Response Latency**');
  lines.push('');
  lines.push(percentileTable('Value', r.submission.apiResponseLatency));
  lines.push('');

  // Processing
  lines.push('#### Job Processing Throughput');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Processed | ${fmtN(r.processing.totalProcessed)} |`);
  lines.push(`| Duration | ${fmtDur(r.processing.durationMs)} |`);
  lines.push(`| **Throughput** | **${fmtRate(r.processing.jobsPerMinute)} jobs/min** |`);
  lines.push(`| Completed | ${fmtN(r.processing.completed)} |`);
  lines.push(`| Failed | ${fmtN(r.processing.failed)} |`);
  lines.push('');

  // Retry
  lines.push('#### Retry Recovery Rate');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Jobs | ${fmtN(r.retry.totalJobs)} |`);
  lines.push(`| Completed | ${fmtN(r.retry.completedJobs)} |`);
  lines.push(`| Retried (attempts > 1) | ${fmtN(r.retry.retriedJobs)} |`);
  lines.push(`| **Recovery Rate** | **${fmtPct(r.retry.retryRecoveryRate)}** |`);
  lines.push(`| Permanently Failed | ${fmtN(r.retry.permanentlyFailed)} |`);
  lines.push(`| Avg Attempts (retried) | ${r.retry.avgAttemptsForRetried.toFixed(1)} |`);
  lines.push(`| Max Attempts | ${r.retry.maxAttempts} |`);
  lines.push('');

  // DLQ
  lines.push('#### Dead Letter Queue Accuracy');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Expected in DLQ | ${fmtN(r.dlq.expectedInDlq)} |`);
  lines.push(`| Found in DLQ | ${fmtN(r.dlq.actualInDlq)} |`);
  lines.push(`| Matched | ${fmtN(r.dlq.matched)} |`);
  lines.push(`| **Accuracy** | **${fmtPct(r.dlq.accuracy)}** |`);
  if (r.dlq.missingFromDlq.length > 0) {
    lines.push(`| Missing IDs | ${r.dlq.missingFromDlq.length} |`);
  }
  lines.push('');

  // Latency (secondary)
  lines.push('#### End-to-End Latency *(secondary)*');
  lines.push('');
  lines.push(percentileTable('Value', r.latency.endToEnd));
  lines.push('');

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

export async function generateReport(report: FullBenchmarkReport): Promise<string> {
  const lines: string[] = [];

  // Header
  lines.push(`# Benchmark Report`);
  lines.push('');
  lines.push(`> Generated: ${report.environment.timestamp}`);
  lines.push('');

  // Environment
  lines.push('## Environment');
  lines.push('');
  lines.push('| Setting | Value |');
  lines.push('|---------|-------|');
  lines.push(`| Node.js | ${report.environment.nodeVersion} |`);
  lines.push(`| Platform | ${report.environment.platform} |`);
  lines.push(`| Worker Delay | ${report.environment.workerDelayMs} |`);
  lines.push(`| Failure Rate | ${report.environment.workerFailureRate} |`);
  lines.push(`| Worker Concurrency | ${report.environment.workerConcurrency} |`);
  lines.push(`| API Base URL | ${report.environment.apiBaseUrl} |`);
  lines.push('');

  // Summary Table
  if (report.results.length > 0) {
    lines.push('## Summary');
    lines.push('');
    lines.push('### Primary Metrics');
    lines.push('');
    lines.push('| Scale | Submit (jobs/s) | Process (jobs/min) | Retry Recovery | DLQ Accuracy | Wall Time |');
    lines.push('|------:|----------------:|-------------------:|---------------:|-------------:|----------:|');
    for (const r of report.results) {
      lines.push(
        `| ${fmtN(r.scale)} ` +
        `| ${fmtRate(r.submission.jobsPerSecond)} ` +
        `| ${fmtRate(r.processing.jobsPerMinute)} ` +
        `| ${fmtPct(r.retry.retryRecoveryRate)} ` +
        `| ${fmtPct(r.dlq.accuracy)} ` +
        `| ${fmtDur(r.processing.durationMs)} |`,
      );
    }
    lines.push('');

    lines.push('### Secondary Metrics (Latency)');
    lines.push('');
    lines.push('| Scale | Median | P95 | P99 | API P95 | API P99 |');
    lines.push('|------:|-------:|----:|----:|--------:|--------:|');
    for (const r of report.results) {
      lines.push(
        `| ${fmtN(r.scale)} ` +
        `| ${fmtMs(r.latency.endToEnd.median)} ` +
        `| ${fmtMs(r.latency.endToEnd.p95)} ` +
        `| ${fmtMs(r.latency.endToEnd.p99)} ` +
        `| ${fmtMs(r.submission.apiResponseLatency.p95)} ` +
        `| ${fmtMs(r.submission.apiResponseLatency.p99)} |`,
      );
    }
    lines.push('');
  }

  // Scalability
  if (report.scalability.length > 0) {
    lines.push('## Worker Scalability');
    lines.push('');
    lines.push('| Workers | Jobs/min | Duration | Scaling Factor |');
    lines.push('|--------:|---------:|---------:|---------------:|');
    for (const s of report.scalability) {
      lines.push(
        `| ${s.concurrency} ` +
        `| ${fmtRate(s.jobsPerMinute)} ` +
        `| ${fmtDur(s.durationMs)} ` +
        `| ${s.scalingFactor.toFixed(1)}x |`,
      );
    }
    lines.push('');
  }

  // Detailed per-scale sections
  if (report.results.length > 0) {
    lines.push('## Detailed Results');
    lines.push('');
    for (const r of report.results) {
      lines.push(scaleSection(r));
    }
  }

  // Write to file
  const resultsDir = path.resolve(BENCHMARK_CONFIG.RESULTS_DIR);
  fs.mkdirSync(resultsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `benchmark-${ts}.md`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');

  return filepath;
}
