#!/usr/bin/env node

/**
 * Benchmark harness for Superconnect pipeline
 *
 * Captures deterministic performance metrics for comparison across versions.
 *
 * Usage:
 *   node scripts/benchmark.js --fixture fixtures/react-sample --output benchmarks/0.2.x/react-sample.json
 *   node scripts/benchmark.js --fixture fixtures/angular-sample --output benchmarks/0.2.x/angular-sample.json
 *
 * Features:
 *   - Deterministic fixture and environment settings
 *   - Wall-clock time measurement
 *   - Environment metadata capture (Node, OS, CPU, memory)
 *   - Structured JSON output for analysis
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { Command } = require('commander');

const program = new Command();

program
  .name('benchmark')
  .description('Run deterministic benchmarks for Superconnect pipeline')
  .requiredOption('-f, --fixture <path>', 'Path to fixture directory (e.g., fixtures/react-sample)')
  .option('-o, --output <path>', 'Output path for benchmark results JSON')
  .option('--concurrency <n>', 'Concurrency level (default: 8)', '8')
  .option('--warmup', 'Run a warmup pass before the measured run')
  .option('--runs <n>', 'Number of benchmark runs to average (default: 1)', '1')
  .parse(process.argv);

const opts = program.opts();

// Resolve paths
const fixtureRoot = path.resolve(process.cwd(), opts.fixture);
const superconnectScript = path.join(__dirname, 'run-pipeline.js');

// Validate inputs
if (!fs.existsSync(fixtureRoot)) {
  console.error(`❌ Fixture not found: ${fixtureRoot}`);
  process.exit(1);
}

if (!fs.existsSync(superconnectScript)) {
  console.error(`❌ Pipeline script not found: ${superconnectScript}`);
  process.exit(1);
}

// Check for required environment variables
const figmaToken = process.env.FIGMA_ACCESS_TOKEN;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!figmaToken) {
  console.error('❌ FIGMA_ACCESS_TOKEN environment variable required');
  process.exit(1);
}

if (!anthropicKey) {
  console.error('❌ ANTHROPIC_API_KEY environment variable required');
  process.exit(1);
}

/**
 * Capture environment metadata
 */
function captureEnvironment() {
  const cpus = os.cpus();
  return {
    timestamp: new Date().toISOString(),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    os_type: os.type(),
    cpu_model: cpus[0]?.model || 'unknown',
    cpu_count: cpus.length,
    cpu_speed_mhz: cpus[0]?.speed || 0,
    total_memory_gb: (os.totalmem() / (1024 ** 3)).toFixed(2),
    free_memory_gb: (os.freemem() / (1024 ** 3)).toFixed(2),
    concurrency: parseInt(opts.concurrency, 10)
  };
}

/**
 * Clean codegen outputs and prepare orientation data
 */
function cleanCodegenOutputs() {
  const codeConnectDir = path.join(fixtureRoot, 'codeConnect');
  const codegenSummariesDir = path.join(fixtureRoot, 'superconnect', 'codegen-summaries');
  const codegenTranscriptsDir = path.join(fixtureRoot, 'superconnect', 'codegen-agent-transcripts');
  const orientationFile = path.join(fixtureRoot, 'superconnect', 'orientation.jsonl');
  const fakeOrientationFile = path.join(fixtureRoot, 'superconnect', 'fake-orientation.jsonl');

  if (fs.existsSync(codeConnectDir)) {
    fs.removeSync(codeConnectDir);
  }
  if (fs.existsSync(codegenSummariesDir)) {
    fs.removeSync(codegenSummariesDir);
  }
  if (fs.existsSync(codegenTranscriptsDir)) {
    fs.removeSync(codegenTranscriptsDir);
  }

  // Use fake orientation data if available (for test fixtures)
  if (fs.existsSync(fakeOrientationFile)) {
    fs.copyFileSync(fakeOrientationFile, orientationFile);
  }
}

/**
 * Run the pipeline and measure time
 */
function runPipeline(isWarmup = false) {
  const label = isWarmup ? 'WARMUP' : 'BENCHMARK';
  console.log(`\n${label}: Running pipeline for ${opts.fixture}...`);

  // Clean codegen outputs before each run to ensure we're measuring actual work
  if (!isWarmup) {
    console.log('  Cleaning previous codegen outputs...');
    cleanCodegenOutputs();
  }

  const startTime = Date.now();
  // Note: We don't use --force to avoid re-fetching Figma data
  // We rely on existing Figma/repo artifacts but clean codegen outputs
  const result = spawnSync('node', [superconnectScript], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      SUPERCONNECT_CONCURRENCY: opts.concurrency
    },
    encoding: 'utf8',
    stdio: isWarmup ? 'ignore' : 'inherit'
  });
  const endTime = Date.now();
  const duration = endTime - startTime;

  if (result.error) {
    console.error(`❌ ${label} failed to spawn:`, result.error);
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(`❌ ${label} exited with code ${result.status}`);
    if (result.stderr) {
      console.error('STDERR:', result.stderr);
    }
    throw new Error(`Pipeline exited with code ${result.status}`);
  }

  console.log(`${label} completed in ${(duration / 1000).toFixed(2)}s`);

  return {
    duration_ms: duration,
    duration_s: (duration / 1000).toFixed(2),
    exit_code: result.status
  };
}

/**
 * Main benchmark execution
 */
async function main() {
  console.log('🔬 Superconnect Benchmark Harness');
  console.log('================================\n');
  console.log(`Fixture: ${opts.fixture}`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log(`Runs: ${opts.runs}`);
  console.log(`Warmup: ${opts.warmup ? 'enabled' : 'disabled'}`);

  // Capture environment
  const environment = captureEnvironment();
  console.log('\n📊 Environment:');
  console.log(`  Node: ${environment.node_version}`);
  console.log(`  Platform: ${environment.platform} ${environment.arch}`);
  console.log(`  CPU: ${environment.cpu_model} (${environment.cpu_count} cores @ ${environment.cpu_speed_mhz} MHz)`);
  console.log(`  Memory: ${environment.total_memory_gb} GB total, ${environment.free_memory_gb} GB free`);

  // Warmup run
  if (opts.warmup) {
    try {
      runPipeline(true);
    } catch (err) {
      console.error('❌ Warmup run failed:', err.message);
      process.exit(1);
    }
  }

  // Measured runs
  const runs = [];
  const numRuns = parseInt(opts.runs, 10);

  for (let i = 0; i < numRuns; i++) {
    try {
      const runLabel = numRuns > 1 ? ` (run ${i + 1}/${numRuns})` : '';
      console.log(`\n📈 Benchmark run${runLabel}`);
      const runResult = runPipeline(false);
      runs.push(runResult);
    } catch (err) {
      console.error(`❌ Benchmark run ${i + 1} failed:`, err.message);
      process.exit(1);
    }
  }

  // Calculate statistics
  const durations = runs.map(r => r.duration_ms);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);

  // Build result
  const result = {
    version: '0.2.x',
    fixture: opts.fixture,
    environment,
    runs,
    statistics: {
      run_count: runs.length,
      avg_duration_ms: Math.round(avgDuration),
      avg_duration_s: (avgDuration / 1000).toFixed(2),
      min_duration_ms: minDuration,
      min_duration_s: (minDuration / 1000).toFixed(2),
      max_duration_ms: maxDuration,
      max_duration_s: (maxDuration / 1000).toFixed(2)
    }
  };

  // Output results
  console.log('\n✅ Benchmark Results:');
  console.log(`  Runs: ${result.statistics.run_count}`);
  console.log(`  Avg: ${result.statistics.avg_duration_s}s`);
  console.log(`  Min: ${result.statistics.min_duration_s}s`);
  console.log(`  Max: ${result.statistics.max_duration_s}s`);

  // Save to file if output specified
  if (opts.output) {
    const outputPath = path.resolve(process.cwd(), opts.output);
    fs.ensureDirSync(path.dirname(outputPath));
    fs.writeJsonSync(outputPath, result, { spaces: 2 });
    console.log(`\n💾 Results saved to: ${outputPath}`);
  } else {
    console.log('\n📄 Results (JSON):');
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('❌ Benchmark failed:', err);
  process.exit(1);
});
