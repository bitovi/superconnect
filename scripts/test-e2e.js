#!/usr/bin/env node
/**
 * E2E Test Runner
 *
 * Tests superconnect pipeline against design system fixtures.
 * Validates generated Code Connect files for structural and semantic correctness.
 * Outputs metrics.json for backend comparison (pass rates, tokens, latency).
 *
 * Usage:
 *   pnpm test:e2e chakra                    # all Chakra components
 *   pnpm test:e2e chakra Button             # single component
 *   pnpm test:e2e chakra Button Alert Input # multiple components
 *   pnpm test:e2e zapui --keep              # preserve artifacts
 *   pnpm test:e2e zapui --agent-sdk         # use Agent SDK mode
 *   pnpm test:e2e --help                    # show help
 *
 * Metrics output (metrics.json in temp dir):
 *   - backend: which API was used (anthropic-messages-api vs anthropic-agent-sdk)
 *   - model: model name
 *   - totalDurationMs: pipeline run time
 *   - components: per-component results with tokens and attempts
 *   - aggregate: totals for pass rate, tokens, retries
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { validateCodeConnect } = require('../src/util/validate-code-connect');
const { extractIR } = require('../src/util/code-connect-ir');

// -----------------------------------------------------------------------------
// Design System Configurations
// -----------------------------------------------------------------------------

const DESIGN_SYSTEMS = {
  chakra: {
    name: 'Chakra UI',
    framework: 'react',
    fixtureDir: 'fixtures/chakra-ui',
    figmaUrl: 'https://www.figma.com/design/7jkNETbphjIb9ap1M7H1o4/Chakra-UI----Figma-Kit--v3---Community-?m=auto&t=0XdgVxllEy8vO4w1-6',
    codeConnectExt: '.figma.tsx'
  },
  zapui: {
    name: 'ZapUI',
    framework: 'angular',
    fixtureDir: 'fixtures/zapui',
    figmaUrl: 'https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-?m=auto&t=0XdgVxllEy8vO4w1-6',
    codeConnectExt: '.figma.ts'
  }
};

// -----------------------------------------------------------------------------
// Semantic Assertions
// -----------------------------------------------------------------------------
// 
// Each component lists the mappings we REQUIRE to exist.
// Format: { figma: 'FigmaPropertyName', prop: 'codePropName', helper: 'helperType' }
//
// - `figma`: Exact Figma property name as it appears in the Figma file
// - `prop`: Expected code prop name in the generated Code Connect
// - `helper`: Expected figma helper type (enum, boolean, string, children, instance)
//
// These are human-authored expectations based on inspecting the Figma files.
// They form the "semantic contract" - if the LLM maps to different props, tests fail.
// -----------------------------------------------------------------------------

const SEMANTIC_ASSERTIONS = {
  // ============================================================================
  // ZapUI - Angular design system
  // Figma file: https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-
  // NOTE: ZapUI uses Title Case for Figma property names (e.g., "Size" not "size")
  // NOTE: LLM prop naming varies - focus on helper type over exact prop names
  // ============================================================================
  zapui: {
    Button: [
      { figma: 'Status', prop: 'type', helper: 'enum' },
      { figma: 'Size', prop: 'size', helper: 'enum' },
      { figma: 'Icon position', prop: 'iconPosition', helper: 'enum' },
      { figma: 'State', prop: 'disabled', helper: 'enum' }
      // Style → variant: LLM varies (style/variant) — not enforced
      // Corner radius → shape: LLM varies (cornerRadius/shape) — not enforced
      // Icon, Image: NOT enforced — multiple valid approaches (input vs projection)
    ],
    Alert: [
      { figma: 'Type', prop: 'type', helper: 'enum' }
      // Style → variant: LLM varies (style/variant) — not enforced
      // Icon: NOT enforced — component has default icons per type
    ],
    Checkbox: [
      { figma: 'Check', prop: 'checked', helper: 'enum' }
    ],
    Chips: [
      { figma: 'Size', prop: 'size', helper: 'enum' },
      { figma: 'Type', prop: 'type', helper: 'enum' }
      // Dismissable: LLM varies between boolean() and enum() — not enforced
      // Style → variant: LLM varies — not enforced
      // Corner radius → shape: LLM varies — not enforced
      // Icon: NOT enforced — multiple valid approaches
    ],
    Badge: [
      // Note: Figma has typo "Succcess" (3 c's)
      { figma: 'Type', prop: 'type', helper: 'enum' }
      // Filled, Style: NOT enforced — many-to-one mapping to variant
    ],
    Select: [
      // Corner radius → shape: LLM varies — not enforced
      // Dropdown location → position: LLM often omits visual-only variants — not enforced
    ],
    Tooltip: [
      // Note: Figma has typo "Corner radsius"
      // Corner radsius → shape: LLM varies — not enforced
    ]
  },
  // ============================================================================
  // Chakra UI - React design system  
  // Figma file: https://www.figma.com/design/7jkNETbphjIb9ap1M7H1o4/Chakra-UI----Figma-Kit--v3---Community-
  // NOTE: Chakra uses camelCase for Figma property names (e.g., "size" not "Size")
  // ============================================================================
  chakra: {
    Accordion: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' }
    ],
    Avatar: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'colorPalette', helper: 'enum' },
      { figma: '.showImage?', skip: true },   // visual toggle, not a code prop
      { figma: 'Avatar-item', skip: true },   // design variant (image vs initials)
      { figma: 'Initials', helper: 'textContent', nested: true }  // prop name varies
      // shape: LLM sometimes omits, similar to .badge?/.ring? — not enforced
      // .badge?, .ring?: BOOLEAN componentProperties, unclear mapping — not enforced
    ],
    Badge: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'Label', helper: 'textContent', nested: true }  // prop name varies (children/label)
      // color: LLM inconsistent (color vs colorPalette) — not enforced
      // .iconStart?, .iconEnd?: BOOLEAN controls structure, no instance to map
    ],
    Button: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'colorPalette', helper: 'enum' },
      { figma: 'state', skip: true },           // visual state (default/hover), not a code prop
      { figma: '.iconStart?', skip: true },     // judgment call: variant restriction OR boolean wrapper
      { figma: '.iconEnd?', skip: true },
      { figma: 'iconStart', helper: 'instance', nested: true },  // may be nested in boolean
      { figma: 'iconEnd', helper: 'instance', nested: true }
      // Button text: should be textContent("Button") but LLM inconsistent — not enforced
    ],
    Alert: [
      { figma: 'status', prop: 'status', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' }
    ],
    Input: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'state', skip: true },        // visual state
      { figma: '.isFilled?', skip: true },   // visual state
      { figma: 'orientation', skip: true }   // single value
      // NOT TESTED - judgment calls for composite component:
      // placeholder, Label, errorText, helperText (string vs textContent)
      // type, .label?, .helperText?, .isInvalid?, .isRequired?, .isOptional?,
      // .leftElement?, .rightElement? (structural coverage)
    ],
    Dialog: [
      { figma: 'size', prop: 'size', helper: 'enum' }
      // .closeTrigger?, .footer?: NOT enforced — slot visibility
    ],
    Popover: [
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: '.showArrow?', helper: 'boolean', nested: true }  // prop name varies
      // .popoverTitle?, .popoverText?, .inputField?: NOT enforced — slot visibility
    ],
    Progress: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'shape', helper: 'enum' },
      { figma: 'colorPalette', helper: 'enum' }
    ],
    Spinner: [
      { figma: 'size', helper: 'enum' },
      { figma: 'colorPalette', helper: 'enum' }
    ],
    Switch: [
      { figma: 'size', helper: 'enum' },
      { figma: 'variant', helper: 'enum' },
      { figma: 'colorPalette', helper: 'enum' }
    ],
    NumberInput: [
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' },
      { figma: '.isRequired?', helper: 'boolean', nested: true }  // prop name varies
      // state, orientation, .isFilled?, .isInvalid?: NOT enforced — visual/addon
    ]
  }
};

// -----------------------------------------------------------------------------
// CLI Parsing
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);

  const config = {
    system: null,
    components: [],
    keep: false,
    agentSdk: true,  // Agent SDK is now the default
    model: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      config.help = true;
    } else if (arg === '--keep') {
      config.keep = true;
    } else if (arg === '--agent-sdk') {
      config.agentSdk = true;  // Explicit enable (already default)
    } else if (arg === '--no-agent-sdk') {
      config.agentSdk = false;  // Use Messages API instead
    } else if (arg === '--model') {
      config.model = args[++i];
      if (!config.model) {
        console.error('--model requires a value');
        process.exit(1);
      }
    } else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else if (!config.system && DESIGN_SYSTEMS[arg.toLowerCase()]) {
      config.system = arg.toLowerCase();
    } else if (config.system) {
      config.components.push(arg);
    } else {
      console.error(`Unknown design system: ${arg}`);
      console.error(`Available: ${Object.keys(DESIGN_SYSTEMS).join(', ')}`);
      process.exit(1);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
E2E Test Runner

Usage:
  pnpm test:e2e <system> [components...] [options]

Systems:
  chakra    Chakra UI (React)
  zapui     ZapUI (Angular)

Options:
  --keep            Preserve temp directory after test (always kept on failure)
  --no-agent-sdk    Use Messages API instead of Agent SDK
  --model <name>    Model to use (default: claude-sonnet-4-5)
  --help            Show this help

Examples:
  pnpm test:e2e chakra                    # Run all Chakra components
  pnpm test:e2e chakra Button             # Test only Button
  pnpm test:e2e chakra Button Alert Input # Test multiple components
  pnpm test:e2e zapui --keep              # Run all ZapUI, keep artifacts
  pnpm test:e2e zapui --no-agent-sdk      # Test with Messages API
`);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Read a secret from environment or .env file.
 */
function readSecret(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const match = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find(line => line.startsWith(`${key}=`));
  if (!match) return null;
  const [, value] = match.split('=');
  return value ? value.trim() : null;
}

/**
 * Run a command and return its output. Throws on non-zero exit.
 */
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[cmd].concat(args).join(' ')}\n${output}`);
  }
  return output;
}

/**
 * Extract metrics from codegen summary files.
 * Returns per-component token usage and attempt counts.
 */
function extractCodegenMetrics(superconnectDir) {
  const summariesDir = path.join(superconnectDir, 'codegen-summaries');
  if (!fs.existsSync(summariesDir)) return [];

  const summaryFiles = fs.readdirSync(summariesDir)
    .filter(f => f.endsWith('-codegen-summary.json'));

  return summaryFiles.map(file => {
    try {
      const data = fs.readJsonSync(path.join(summariesDir, file));
      const attempts = data.attempts || [];
      
      // Sum tokens across all attempts
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      
      for (const attempt of attempts) {
        if (attempt.usage) {
          inputTokens += attempt.usage.inputTokens || 0;
          outputTokens += attempt.usage.outputTokens || 0;
          cacheReadTokens += attempt.usage.cacheReadTokens || 0;
          cacheWriteTokens += attempt.usage.cacheWriteTokens || 0;
        }
      }

      return {
        component: data.figmaName || file.replace('-codegen-summary.json', ''),
        status: data.status,
        attemptCount: attempts.length,
        tokens: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
        totalTokens: inputTokens + outputTokens
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Build metrics summary from collected data.
 */
function buildMetrics({ backend, model, system, pipelineDurationMs, codegenMetrics, 
                        structuralErrors, semanticErrors, componentCount, failed, failureReason }) {
  // Aggregate token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalAttempts = 0;
  let builtCount = 0;

  for (const m of codegenMetrics) {
    totalInputTokens += m.tokens.inputTokens;
    totalOutputTokens += m.tokens.outputTokens;
    totalCacheReadTokens += m.tokens.cacheReadTokens;
    totalCacheWriteTokens += m.tokens.cacheWriteTokens;
    totalAttempts += m.attemptCount;
    if (m.status === 'built') builtCount++;
  }

  const structuralPassCount = componentCount - (structuralErrors?.length || 0);
  const semanticPassCount = componentCount - (semanticErrors?.length || 0);

  return {
    timestamp: new Date().toISOString(),
    backend,
    model,
    system,
    failed: failed || false,
    failureReason: failureReason || null,
    
    timing: {
      pipelineDurationMs,
      pipelineDurationSec: Math.round(pipelineDurationMs / 1000 * 10) / 10,
      avgPerComponentMs: componentCount > 0 ? Math.round(pipelineDurationMs / componentCount) : 0
    },
    
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      cacheRead: totalCacheReadTokens,
      cacheWrite: totalCacheWriteTokens,
      total: totalInputTokens + totalOutputTokens,
      avgPerComponent: componentCount > 0 ? Math.round((totalInputTokens + totalOutputTokens) / componentCount) : 0
    },
    
    quality: {
      componentCount,
      builtCount,
      structuralPassCount,
      semanticPassCount,
      totalAttempts,
      avgAttemptsPerComponent: componentCount > 0 ? Math.round(totalAttempts / componentCount * 10) / 10 : 0,
      structuralPassRate: componentCount > 0 ? Math.round(structuralPassCount / componentCount * 100) : 0,
      semanticPassRate: componentCount > 0 ? Math.round(semanticPassCount / componentCount * 100) : 0
    },
    
    components: codegenMetrics
  };
}

/**
 * Print a human-readable metrics summary.
 */
function printMetricsSummary(metrics) {
  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log(`│  Backend: ${metrics.backend.padEnd(20)} Model: ${metrics.model.slice(0, 18).padEnd(18)} │`);
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│  Duration: ${String(metrics.timing.pipelineDurationSec + 's').padEnd(10)} (${metrics.timing.avgPerComponentMs}ms/component)`.padEnd(54) + '│');
  console.log(`│  Tokens:   ${String(metrics.tokens.total).padEnd(10)} (${metrics.tokens.avgPerComponent}/component)`.padEnd(54) + '│');
  console.log(`│  Cache:    ${metrics.tokens.cacheRead} read, ${metrics.tokens.cacheWrite} write`.padEnd(42) + '│');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│  Components: ${metrics.quality.builtCount}/${metrics.quality.componentCount} built`.padEnd(42) + '│');
  console.log(`│  Structural: ${metrics.quality.structuralPassRate}% pass`.padEnd(42) + '│');
  console.log(`│  Semantic:   ${metrics.quality.semanticPassRate}% pass`.padEnd(42) + '│');
  console.log(`│  Retries:    ${metrics.quality.avgAttemptsPerComponent} avg attempts/component`.padEnd(42) + '│');
  console.log('└─────────────────────────────────────────────────────┘');
}

/**
 * Copy fixture directory, excluding .git and node_modules.
 */
function copyFixture(src, dest) {
  fs.copySync(src, dest, {
    dereference: true,
    filter: (srcPath) => {
      const base = path.basename(srcPath);
      if (base === '.git' || base === '.husky' || base === 'node_modules') return false;
      return !srcPath.includes(`${path.sep}.git${path.sep}`);
    }
  });
}

/**
 * Write superconnect.toml configuration.
 */
function writeSuperconnectConfig(destDir, figmaUrl, agentSdk, model) {
  const api = agentSdk ? 'anthropic-agent-sdk' : 'anthropic-messages-api';
  const effectiveModel = model || 'claude-sonnet-4-5';

  const toml = [
    '[inputs]',
    `figma_file_url = "${figmaUrl}"`,
    'component_repo_path = "."',
    '',
    '[agent]',
    `api = "${api}"`,
    `model = "${effectiveModel}"`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(destDir, 'superconnect.toml'), toml, 'utf8');
}

/**
 * Get generated Code Connect files from output directory.
 */
function getGeneratedConnectors(outputDir, ext) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir).filter(file => file.endsWith(ext));
}

/**
 * Validate semantic assertions for a component.
 *
 * Assertion format:
 *   { figma, helper }                    - prop defaults to figma name
 *   { figma, prop, helper }              - explicit prop name
 *   { figma, skip: true }                - documented but not enforced
 *   { figma, helper, nested: true }      - helper can appear nested (e.g. instance inside boolean)
 *   { figma, mustBeVariantOnly }         - must NOT be a prop mapping
 */
function validateSemanticAssertions(componentName, ir, designSystem, code = '') {
  const assertions = SEMANTIC_ASSERTIONS[designSystem]?.[componentName];
  if (!assertions) return;

  if (ir.connects.length === 0) {
    throw new Error(`${componentName}: No figma.connect() calls found`);
  }

  const allHelpers = ir.connects.flatMap(c => c.config?.props?.helpers || []);
  const allVariantRestrictions = ir.connects
    .map(c => c.config?.variant?.restrictions)
    .filter(Boolean);

  for (const assertion of assertions) {
    const { figma, helper, mustBeVariantOnly, skip, nested } = assertion;
    const prop = assertion.prop || figma;

    if (skip) continue;

    if (nested && code) {
      const hasNestedHelper = code.includes(`figma.${helper}("${figma}"`) ||
                              code.includes(`figma.${helper}('${figma}'`);
      if (hasNestedHelper) continue;
      throw new Error(
        `${componentName}: Missing figma.${helper}("${figma}") (may be nested)`
      );
    }

    const propsMapping = allHelpers.find(h => h.key === figma);
    const hasVariantForProperty = allVariantRestrictions.some(r => figma in r);

    if (mustBeVariantOnly) {
      if (propsMapping) {
        throw new Error(
          `${componentName}: '${figma}' must NOT be a prop mapping (found ${propsMapping.helper})`
        );
      }
      continue;
    }

    if (propsMapping) {
      if (propsMapping.propName.toLowerCase() !== prop.toLowerCase()) {
        throw new Error(
          `${componentName}: '${figma}' mapped to '${propsMapping.propName}', expected '${prop}'`
        );
      }
      if (propsMapping.helper !== helper) {
        throw new Error(
          `${componentName}: '${figma}' used '${propsMapping.helper}', expected '${helper}'`
        );
      }
      continue;
    }

    if (hasVariantForProperty) continue;

    throw new Error(
      `${componentName}: Missing mapping for '${figma}' → '${prop}' (${helper})`
    );
  }
}

// -----------------------------------------------------------------------------
// Main Test Logic
// -----------------------------------------------------------------------------

function runE2E(config) {
  const ds = DESIGN_SYSTEMS[config.system];
  const repoRoot = path.join(__dirname, '..');
  const fixtureRoot = path.join(repoRoot, ds.fixtureDir);
  const superconnectScript = path.join(repoRoot, 'scripts', 'run-pipeline.js');
  const figmaCli = path.join(repoRoot, 'node_modules', '.bin', 'figma');

  // Check prerequisites
  if (!fs.existsSync(fixtureRoot) || !fs.existsSync(path.join(fixtureRoot, 'package.json'))) {
    throw new Error(`${ds.name} fixture missing. Run: git submodule update --init ${ds.fixtureDir}`);
  }
  if (!fs.existsSync(figmaCli)) {
    throw new Error('Figma CLI missing. Run: pnpm install');
  }

  // Check secrets
  const figmaToken = readSecret('FIGMA_ACCESS_TOKEN');
  const anthropicKey = readSecret('ANTHROPIC_API_KEY');
  if (!figmaToken) throw new Error('FIGMA_ACCESS_TOKEN not set');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

  const env = {
    ...process.env,
    FIGMA_ACCESS_TOKEN: figmaToken,
    ANTHROPIC_API_KEY: anthropicKey
  };

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${config.system}-e2e-`));
  console.log(`Temp directory: ${tmpDir}`);

  try {
    // Setup
    copyFixture(fixtureRoot, tmpDir);
    writeSuperconnectConfig(tmpDir, ds.figmaUrl, config.agentSdk, config.model);
    fs.removeSync(path.join(tmpDir, 'superconnect-logs'));
    fs.removeSync(path.join(tmpDir, 'codeConnect'));

    // Run superconnect with timing
    const args = [superconnectScript, '--framework', ds.framework, '--force'];
    if (config.components.length > 0) {
      args.push('--only', config.components.join(','));
    }
    console.log(`Running: node ${args.join(' ')}`);
    const pipelineStart = Date.now();
    run('node', args, { cwd: tmpDir, env });
    const pipelineDurationMs = Date.now() - pipelineStart;
    console.log(`Pipeline completed in ${(pipelineDurationMs / 1000).toFixed(1)}s`);

    // Verify files were generated
    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = getGeneratedConnectors(outputDir, ds.codeConnectExt);

    if (connectors.length === 0) {
      throw new Error('No Code Connect files were generated');
    }
    console.log(`Generated ${connectors.length} connector(s): ${connectors.join(', ')}`);

    if (config.components.length > 0 && connectors.length < config.components.length) {
      throw new Error(
        `Expected at least ${config.components.length} connectors, got ${connectors.length}`
      );
    }

    // Build code cache for validation layers
    const figmaDir = path.join(tmpDir, 'superconnect-logs', 'figma-components');
    const connectorCode = new Map();
    for (const file of connectors) {
      connectorCode.set(file, fs.readFileSync(path.join(outputDir, file), 'utf8'));
    }

    // Layer 1: Structural validation
    const structuralErrors = [];
    for (const file of connectors) {
      const slug = file.replace(ds.codeConnectExt, '');
      const evidencePath = path.join(figmaDir, `${slug}.json`);

      if (fs.existsSync(evidencePath)) {
        const figmaEvidence = fs.readJsonSync(evidencePath);
        const validation = validateCodeConnect({
          generatedCode: connectorCode.get(file),
          figmaEvidence
        });
        if (!validation.valid) {
          structuralErrors.push({ file, errors: validation.errors });
        }
      }
    }

    if (structuralErrors.length > 0) {
      console.error('\nStructural validation errors:');
      for (const { file, errors } of structuralErrors) {
        console.error(`  ${file}:`);
        errors.forEach(err => console.error(`    - ${err}`));
      }
      throw new Error('Structural validation failed');
    }

    // Layer 2: Semantic validation
    const semanticErrors = [];
    const componentsToValidate = config.components.length > 0
      ? config.components
      : Object.keys(SEMANTIC_ASSERTIONS[config.system] || {});

    for (const componentName of componentsToValidate) {
      const file = connectors.find(f =>
        f.toLowerCase().includes(componentName.toLowerCase())
      );
      if (!file) {
        if (SEMANTIC_ASSERTIONS[config.system]?.[componentName]) {
          semanticErrors.push({ component: componentName, error: 'Not generated' });
        }
        continue;
      }

      try {
        const code = connectorCode.get(file);
        const ir = extractIR(code, file);
        validateSemanticAssertions(componentName, ir, config.system, code);
      } catch (err) {
        semanticErrors.push({ component: componentName, error: err.message });
      }
    }

    if (semanticErrors.length > 0) {
      console.error('\nSemantic validation errors:');
      for (const { component, error } of semanticErrors) {
        console.error(`  ${component}: ${error}`);
      }
      throw new Error('Semantic validation failed');
    }

    // Layer 3: Figma CLI validation
    console.log('\nRunning Figma CLI validation...');
    const publishOutput = run(
      figmaCli,
      [
        'connect', 'publish',
        '--dry-run',
        '--exit-on-unreadable-files',
        '--skip-update-check',
        '--outDir', path.join(tmpDir, 'superconnect-logs', 'code-connect-json')
      ],
      { cwd: tmpDir, env }
    );

    if (!publishOutput.includes('All Code Connect files are valid')) {
      throw new Error(`Figma CLI validation failed:\n${publishOutput}`);
    }

    console.log('\n✅ All validations passed');

    // Collect and write metrics
    const codegenMetrics = extractCodegenMetrics(path.join(tmpDir, 'superconnect-logs'));
    const metrics = buildMetrics({
      backend: config.agentSdk ? 'claude-agent-sdk' : 'anthropic',
      model: config.model || 'claude-sonnet-4-5',
      system: config.system,
      pipelineDurationMs,
      codegenMetrics,
      structuralErrors: [],
      semanticErrors: [],
      componentCount: connectors.length
    });
    
    const metricsPath = path.join(tmpDir, 'metrics.json');
    fs.writeJsonSync(metricsPath, metrics, { spaces: 2 });
    console.log(`\n📊 Metrics written to: ${metricsPath}`);
    printMetricsSummary(metrics);

    return { success: true, tmpDir, metrics };

  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    
    // Still collect metrics on failure for comparison
    const codegenMetrics = extractCodegenMetrics(path.join(tmpDir, 'superconnect-logs'));
    const metrics = buildMetrics({
      backend: config.agentSdk ? 'claude-agent-sdk' : 'anthropic',
      model: config.model || 'claude-sonnet-4-5',
      system: config.system,
      pipelineDurationMs: typeof pipelineDurationMs !== 'undefined' ? pipelineDurationMs : 0,
      codegenMetrics,
      structuralErrors: typeof structuralErrors !== 'undefined' ? structuralErrors : [],
      semanticErrors: typeof semanticErrors !== 'undefined' ? semanticErrors : [],
      componentCount: typeof connectors !== 'undefined' ? connectors.length : 0,
      failed: true,
      failureReason: error.message
    });
    
    const metricsPath = path.join(tmpDir, 'metrics.json');
    fs.writeJsonSync(metricsPath, metrics, { spaces: 2 });
    console.log(`\n📊 Metrics written to: ${metricsPath}`);
    
    // Always keep on failure
    console.error(`Artifacts preserved at: ${tmpDir}`);
    return { success: false, tmpDir, error, metrics };
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main() {
  const config = parseArgs(process.argv);

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  if (!config.system) {
    console.error('Error: Please specify a design system (chakra or zapui)');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  const ds = DESIGN_SYSTEMS[config.system];
  const scopeLabel = config.components.length > 0
    ? config.components.join(', ')
    : 'all components';
  const modeLabel = config.agentSdk ? ' (agent SDK)' : '';
  console.log(`\n🧪 ${ds.name} E2E: ${scopeLabel}${modeLabel}\n`);

  const result = runE2E(config);

  if (result.success && !config.keep) {
    fs.removeSync(result.tmpDir);
    console.log('Temp directory cleaned up');
  } else if (result.success) {
    console.log(`Artifacts preserved at: ${result.tmpDir}`);
  }

  process.exit(result.success ? 0 : 1);
}

main();
