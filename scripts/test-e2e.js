#!/usr/bin/env node
/**
 * Unified E2E Test Runner
 * 
 * Usage:
 *   pnpm test:e2e chakra                    # all Chakra components
 *   pnpm test:e2e chakra Button             # single component
 *   pnpm test:e2e chakra Button Alert Input # multiple components
 *   pnpm test:e2e zapui --keep              # preserve artifacts
 *   pnpm test:e2e --help                    # show help
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const DESIGN_SYSTEMS = {
  chakra: {
    testFile: 'test/chakra-e2e.test.js',
    runEnv: 'RUN_CHAKRA_E2E',
    onlyEnv: 'CHAKRA_E2E_ONLY'
  },
  zapui: {
    testFile: 'test/zapui-e2e.test.js',
    runEnv: 'RUN_ZAPUI_E2E',
    onlyEnv: 'ZAPUI_E2E_ONLY'
  }
};

// -----------------------------------------------------------------------------
// CLI Parsing
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  
  const options = {
    system: null,
    components: [],
    keep: false,
    help: false
  };
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--keep') {
      options.keep = true;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else if (!options.system && DESIGN_SYSTEMS[arg.toLowerCase()]) {
      options.system = arg.toLowerCase();
    } else if (options.system) {
      options.components.push(arg);
    } else {
      console.error(`Unknown design system: ${arg}`);
      console.error(`Available: ${Object.keys(DESIGN_SYSTEMS).join(', ')}`);
      process.exit(1);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
Unified E2E Test Runner

Usage:
  pnpm test:e2e <system> [components...] [options]

Systems:
  chakra    Chakra UI (React)
  zapui     ZapUI (Angular)

Options:
  --keep      Preserve temp directory after test (always kept on failure)
  --help      Show this help

Examples:
  pnpm test:e2e chakra                    # Run all Chakra components
  pnpm test:e2e chakra Button             # Test only Button
  pnpm test:e2e chakra Button Alert Input # Test multiple components
  pnpm test:e2e zapui --keep              # Run all ZapUI, keep artifacts
`);
}

// -----------------------------------------------------------------------------
// Test Execution
// -----------------------------------------------------------------------------

function runTests(options) {
  const config = DESIGN_SYSTEMS[options.system];
  
  // Build environment
  const env = { ...process.env };
  env[config.runEnv] = '1';
  
  if (options.keep) {
    env.E2E_KEEP = '1';
  }
  
  // Set component filter if specified
  if (options.components.length > 0) {
    env[config.onlyEnv] = options.components.join(',');
  }
  
  // Print what we're doing
  const systemLabel = options.system === 'chakra' ? 'Chakra UI' : 'ZapUI';
  const scopeLabel = options.components.length > 0
    ? options.components.join(', ')
    : 'all components';
  console.log(`\nRunning ${systemLabel} E2E tests: ${scopeLabel}\n`);
  
  // Run Jest
  const jestPath = path.join(__dirname, '..', 'node_modules', '.bin', 'jest');
  const result = spawnSync(jestPath, [config.testFile], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  });
  
  process.exit(result.status || 0);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv);
  
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  
  if (!options.system) {
    console.error('Error: Please specify a design system (chakra or zapui)');
    console.error('Run with --help for usage');
    process.exit(1);
  }
  
  runTests(options);
}

main();
