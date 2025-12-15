#!/usr/bin/env node

// Load environment variables from .env file early
require('dotenv').config();

/**
 * Superconnect pipeline v4 (5 stages):
 * 1) Figma scan
 * 2) Repo summarizer
 * 3) Orienter
 * 4) Codegen
 * 5) Finalizer (summary)
 */

const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const { Command } = require('commander');
const readline = require('readline');
const chalk = require('chalk');
const toml = require('@iarna/toml');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');

const DEFAULT_CONFIG_FILE = 'superconnect.toml';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.1-codegen-mini';
const DEFAULT_BACKEND = 'claude';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_ORIENTATION_MAX_TOKENS = 32768;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_LAYER_DEPTH = 3;
const DEFAULT_CONCURRENCY = 8;

const parseMaybeInt = (value) => {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function loadSuperconnectConfig(filePath = 'superconnect.toml') {
  const direct = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(direct)) return null;
  try {
    const raw = fs.readFileSync(direct, 'utf8');
    return toml.parse(raw);
  } catch (err) {
    console.warn(`⚠️  Failed to load ${direct}: ${err.message}`);
    if (err.message.includes('parse') || err.message.includes('Expected')) {
      console.warn('💡 TOML syntax error - check your configuration file syntax');
      console.warn('   Valid TOML guide: https://toml.io/en/v1.0.0');
    }
    return null;
  }
}

function normalizeAgentConfig(agentSection = {}) {
  const backendRaw = (agentSection.backend || DEFAULT_BACKEND).toLowerCase();
  const backend = backendRaw === 'openai' || backendRaw === 'claude' ? backendRaw : DEFAULT_BACKEND;
  const model =
    agentSection.sdk_model ||
    (backend === 'openai'
      ? DEFAULT_OPENAI_MODEL
      : DEFAULT_CLAUDE_MODEL);
  const maxTokens = parseMaybeInt(agentSection.max_tokens);
  const resolvedMaxTokens = backend === 'claude' ? maxTokens || DEFAULT_MAX_TOKENS : maxTokens || null;
  return { backend, model, maxTokens: resolvedMaxTokens };
}

/**
 * Normalize [codegen] section from TOML config.
 * @param {object} codegenSection - The [codegen] section from TOML
 * @returns {{ maxRetries: number, concurrency: number }}
 */
function normalizeCodegenConfig(codegenSection = {}) {
  const maxRetries = parseMaybeInt(codegenSection.max_retries) ?? DEFAULT_MAX_RETRIES;
  const concurrency = parseMaybeInt(codegenSection.concurrency) ?? DEFAULT_CONCURRENCY;
  return { maxRetries, concurrency };
}

/**
 * Normalize [figma] section from TOML config.
 * @param {object} figmaSection - The [figma] section from TOML
 * @returns {{ layerDepth: number }}
 */
function normalizeFigmaConfig(figmaSection = {}) {
  const layerDepth = parseMaybeInt(figmaSection.layer_depth) ?? DEFAULT_LAYER_DEPTH;
  return { layerDepth };
}

async function promptForConfig() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));

  console.log(`${chalk.yellow('No superconnect.toml found in this directory.')}`);
  const figmaUrl = await (async () => {
    while (true) {
      const value = await question(`${chalk.cyan('Enter Figma file URL or key')}: `);
      if (value) return value;
      console.log(chalk.red('Figma URL is required.'));
    }
  })();

  const repoPathInput = await question(
    `${chalk.cyan('Enter component repo path')} [${chalk.dim('.')}]: `
  );
  const repoPath = repoPathInput || '.';

  const backendInput = await question(
    `${chalk.cyan('Agent backend')} (default ${chalk.dim(DEFAULT_BACKEND)}): `
  );
  const backend = (backendInput || DEFAULT_BACKEND).toLowerCase();
  const normalizedBackend = backend === 'openai' || backend === 'claude' ? backend : 'claude';

  rl.close();

  const active = normalizedBackend;
  const chooseModel = (b) => {
    if (b === 'openai') return DEFAULT_OPENAI_MODEL;
    return DEFAULT_CLAUDE_MODEL;
  };
  const sdkModel = chooseModel(active);
  const maxTokens = DEFAULT_MAX_TOKENS;

  const agentSection = [];
  const pushActive = (header, lines) => {
    agentSection.push(header);
    lines.forEach((line) => agentSection.push(line));
    agentSection.push('');
  };
  if (active === 'claude') {
    pushActive(
      '# Using Claude SDK (requires ANTHROPIC_API_KEY environment var)',
      [
        'backend = "claude"                  # options: openai, claude',
        `sdk_model = "${sdkModel}"`
      ]
    );
    pushActive(
      '# Using OpenAI SDK (requires OPENAI_API_KEY environment var)',
      [
        '# backend = "openai"',
        `# sdk_model = "${DEFAULT_OPENAI_MODEL}"`
      ]
    );
  } else if (active === 'openai') {
    pushActive(
      '# Using OpenAI SDK (requires OPENAI_API_KEY environment var)',
      [
        'backend = "openai"',
        `sdk_model = "${sdkModel}"`
      ]
    );
    pushActive(
      '# Using Claude SDK (requires ANTHROPIC_API_KEY environment var)',
      [
        '# backend = "claude"',
        `# sdk_model = "${DEFAULT_CLAUDE_MODEL}"`
      ]
    );
  } else {
    pushActive(
      '# Using Claude SDK (requires ANTHROPIC_API_KEY environment var)',
      [
        'backend = "claude"',
        `sdk_model = "${sdkModel}"`
      ]
    );
    pushActive(
      '# Using OpenAI SDK (requires OPENAI_API_KEY environment var)',
      [
        '# backend = "openai"',
        `# sdk_model = "${DEFAULT_OPENAI_MODEL}"`
      ]
    );
  }

  const tomlContent = [
    '[inputs]',
    '# (Requires FIGMA_ACCESS_TOKEN environment var)',
    `figma_url = "${figmaUrl}"`,
    `component_repo_path = "${repoPath}"`,
    '',
    '[agent]',
    `max_tokens = ${maxTokens}`,
    ...agentSection,
    '',
    '[codegen]',
    'max_retries = 2       # Retry attempts on validation failure',
    'concurrency = 8       # Max parallel LLM requests during code generation',
    ''
  ].join('\n');

  const outPath = path.resolve(DEFAULT_CONFIG_FILE);
  fs.writeFileSync(outPath, tomlContent, 'utf8');
  console.log(`${chalk.green('✓')} Wrote your configs to ${DEFAULT_CONFIG_FILE}. When you next run in this directory, we'll read from that instead.`);
  return toml.parse(tomlContent);
}

function runCommand(label, command, options = {}) {
  console.log(`${chalk.dim('•')} ${label}`);
  const { env: extraEnv, allowInterrupt = false, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  const shouldCapture = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPERCONNECT_E2E_VERBOSE || '').toLowerCase());
  const result = spawnSync(command, {
    stdio: shouldCapture ? 'pipe' : 'inherit',
    shell: true,
    env: mergedEnv,
    ...rest
  });
  if (result.signal === 'SIGINT' && allowInterrupt) {
    console.warn(`⚠️  ${label} interrupted by SIGINT; continuing to finalize...`);
    return;
  }
  if (result.status !== 0) {
    const status = result.status || 1;
    if (shouldCapture) {
      const stdout = result.stdout ? result.stdout.toString().trim() : '';
      const stderr = result.stderr ? result.stderr.toString().trim() : '';
      console.error(`❌ ${label} failed with code ${status}`);
      console.error(`Command: ${command}`);
      if (stdout) {
        console.error(`stdout:\n${stdout}`);
      } else {
        console.error('stdout: (empty)');
      }
      if (stderr) {
        console.error(`stderr:\n${stderr}`);
      } else {
        console.error('stderr: (empty)');
      }
      if (result.error) {
        console.error(`spawn error: ${result.error.stack || result.error.message || result.error}`);
      }
    } else {
      console.error(`❌ ${label} failed with code ${status}`);
    }
    process.exit(status);
  }
}

function parseArgv(argv) {
  const program = new Command();
  program
    .name('run-pipeline')
    .usage('[options]')
    .option('--figma-url <value>', 'Figma file URL or key (needed for figma scan when not cached)')
    .option('--figma-token <token>', 'Figma API token (or FIGMA_ACCESS_TOKEN/.env)')
    .option('--target <path>', 'Target repo to write Code Connect into')
    .option('--framework <name>', 'Target framework override (react|angular)')
    .option('--force', 'Re-run stages even if outputs exist')
    .option('--dry-run', 'Skip agent-powered stages; still run summary', false)
    .option('--only <list...>', 'Component names/IDs (globs allowed) to include; accepts comma or space separated values')
    .option('--exclude <list...>', 'Component names/IDs (globs allowed) to skip');
  program.parse(argv);
  const opts = program.opts();
  const parseList = (values) => {
    const raw = Array.isArray(values) ? values : values ? [values] : [];
    return raw
      .flatMap((item) => String(item).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  };

  return {
    figmaUrl: opts.figmaUrl || undefined,
    figmaToken: opts.figmaToken,
    target: opts.target ? path.resolve(opts.target) : undefined,
    force: Boolean(opts.force),
    framework: opts.framework || undefined,
    dryRun: Boolean(opts.dryRun),
    only: parseList(opts.only),
    exclude: parseList(opts.exclude)
  };
}

function loadEnvToken() {
  return process.env.FIGMA_ACCESS_TOKEN || null;
}

function loadAgentToken(backend) {
  const envVar = backend === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  return process.env[envVar] || null;
}

function resolvePaths(config) {
  const target = config.target;
  const scriptDir = __dirname;
  const superconnectDir = path.join(target, 'superconnect');
  const figmaDir = path.join(superconnectDir, 'figma-components');
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  const repoSummary = path.join(superconnectDir, 'repo-summary.json');
  const orientation = path.join(superconnectDir, 'orientation.jsonl');
  const agentLogDir = path.join(superconnectDir, 'orienter-agent.log');
  const codegenLogDir = path.join(superconnectDir, 'mapping-agent-logs');
  const codeConnectDir = path.join(target, 'codeConnect');
  const summaryFile = path.join(config.target, 'SUPERCONNECT_SUMMARY.md');

  return {
    ...config,
    scriptDir,
    superconnectDir,
    figmaDir,
    figmaIndex,
    repoSummary,
    orientation,
    agentLogDir,
    codegenLogDir,
    codeConnectDir,
    summaryFile
  };
}

async function main() {
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\n${chalk.yellow('Received SIGINT. Attempting graceful stop after current stage...')}`);
  });

  const args = parseArgv(process.argv);
  const prospectiveTarget = args.target ? path.resolve(args.target) : path.resolve('.');
  const prospectiveFigmaIndex = path.join(prospectiveTarget, 'superconnect', 'figma-components-index.json');
  const figmaIndexMissing = !fs.existsSync(prospectiveFigmaIndex);

  if (figmaIndexMissing && !args.figmaToken && !loadEnvToken()) {
    console.error('❌ FIGMA_ACCESS_TOKEN is required to run the Figma scan.');
    console.error('   Set FIGMA_ACCESS_TOKEN in your environment or .env, or pass --figma-token.');
    process.exit(1);
  }

  let cfg = loadSuperconnectConfig(DEFAULT_CONFIG_FILE);
  if (cfg) {
    console.log(`${chalk.green('✓')} Using ${highlight(DEFAULT_CONFIG_FILE)} in ${process.cwd()}`);
  } else {
    cfg = await promptForConfig();
    if (!cfg) {
      console.error('❌ Failed to initialize superconnect.toml');
      process.exit(1);
    }
  }
  const figmaUrl = args.figmaUrl || cfg.inputs?.figma_url || undefined;
  const target =
    args.target ||
    (cfg.inputs?.component_repo_path ? path.resolve(cfg.inputs.component_repo_path) : path.resolve('.'));
  const figmaToken = args.figmaToken || loadEnvToken();
  const agentConfig = normalizeAgentConfig(cfg.agent || {});
  const codegenConfig = normalizeCodegenConfig(cfg.codegen || {});
  const figmaConfig = normalizeFigmaConfig(cfg.figma || {});
  const agentEnvVar = agentConfig.backend === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const agentToken = loadAgentToken(agentConfig.backend);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${target}`);
    process.exit(1);
  }
  const paths = resolvePaths({ ...args, figmaUrl, target, figmaToken });

  const agentLabel =
    agentConfig.backend === 'openai'
      ? `openai${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`
      : `claude${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`;
  console.log(`${chalk.dim('•')} ${highlight('Agent backend')}: ${highlight(agentLabel)}`);

  fs.ensureDirSync(paths.superconnectDir);
  fs.ensureDirSync(paths.figmaDir);

  const needFigmaScan = args.force || !fs.existsSync(paths.figmaIndex);
  const needRepoSummary = args.force || !fs.existsSync(paths.repoSummary);
  const needOrientation = args.force || !fs.existsSync(paths.orientation);
  const rel = (p) => path.relative(process.cwd(), p) || p;

  const needsAgent = !args.dryRun;
  if (needsAgent && !agentToken) {
    console.error(`❌ ${agentEnvVar} is required to run agent-backed stages (${agentConfig.backend}).`);
    console.error(`   Set ${agentEnvVar} in your environment or .env, or switch to --dry-run.`);
    process.exit(1);
  }

  if (needRepoSummary) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'summarize-repo.js')}`,
      `--root "${paths.target}"`
    ].join(' ');
    runCommand(`${highlight('Repo overview')} → ${codeColor(rel(paths.repoSummary))}`, cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo overview')} (skipped, ${codeColor(
        rel(paths.repoSummary)
      )} present)`
    );
  }
  let inferredFramework = args.framework || null;
  try {
    const summaryData = fs.readJsonSync(paths.repoSummary);
    if (!inferredFramework && summaryData?.primary_framework) {
      inferredFramework = summaryData.primary_framework;
    }
  } catch {
    // ignore; will remain null
  }

  if (needFigmaScan && !figmaToken) {
    console.error('❌ FIGMA_ACCESS_TOKEN is required to run the Figma scan.');
    console.error('   Set FIGMA_ACCESS_TOKEN in your environment or .env, or pass --figma-token.');
    process.exit(1);
  }

  if (needFigmaScan) {
    if (!paths.figmaUrl) {
      console.error('❌ --figma-url is required for figma scan when no index exists.');
      process.exit(1);
    }
    const cmd = [
      `node ${path.join(paths.scriptDir, 'figma-scan.js')}`,
      `"${paths.figmaUrl}"`,
      `--token "${figmaToken || ''}"`,
      `--output "${paths.figmaDir}"`,
      `--index "${paths.figmaIndex}"`,
      `--layer-depth ${figmaConfig.layerDepth}`
    ].join(' ');
    runCommand(`${highlight('Figma scan')} → ${figmaColor(rel(paths.figmaIndex))}`, cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Figma scan')} (skipped, ${figmaColor(
        rel(paths.figmaIndex)
      )} already present)`
    );
  }

  if (needOrientation) {
    // Orientation agent needs much higher max_tokens to output JSONL for all components.
    // Use explicit user setting if provided, otherwise use orientation-specific default.
    const userMaxTokens = parseMaybeInt(cfg?.agent?.max_tokens);
    const orientationMaxTokens = userMaxTokens || DEFAULT_ORIENTATION_MAX_TOKENS;
    const cmd = [
      `node ${path.join(paths.scriptDir, 'run-orienter.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--repo-summary "${paths.repoSummary}"`,
      `--output "${paths.orientation}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      `--agent-max-tokens "${orientationMaxTokens}"`,
      inferredFramework ? `--target-framework "${inferredFramework}"` : '',
      args.dryRun ? '--dry-run' : ''
    ].join(' ');
    runCommand(`${highlight('Repo orientation')} → ${generatedColor(rel(paths.orientation))}`, cmd, {
      env: {
        FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
        [agentEnvVar]: agentToken || process.env[agentEnvVar]
      }
    });
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo orientation')} (skipped, ${generatedColor(
        rel(paths.orientation)
      )} already present)`
    );
  }

  if (!args.dryRun) {
    const codegenCmd = [
      `node ${path.join(paths.scriptDir, 'run-codegen.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--orienter "${paths.orientation}"`,
      `--repo-summary "${paths.repoSummary}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      agentConfig.maxTokens ? `--agent-max-tokens "${agentConfig.maxTokens}"` : '',
      `--concurrency "${codegenConfig.concurrency}"`,
      args.only && args.only.length ? `--only "${args.only.join(',')}"` : '',
      args.exclude && args.exclude.length ? `--exclude "${args.exclude.join(',')}"` : '',
      inferredFramework ? `--target-framework "${inferredFramework}"` : '',
      args.force ? '--force' : ''
    ]
      .filter(Boolean)
      .join(' ');
    runCommand(
      `${highlight('Code generation')} (${codeColor(rel(paths.orientation))} → ${generatedColor(rel(paths.codeConnectDir))})`,
      codegenCmd,
      {
        cwd: paths.target,
        allowInterrupt: true,
        env: {
          FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
          [agentEnvVar]: agentToken || process.env[agentEnvVar]
        }
      }
    );
  } else {
    console.log(`${chalk.dim('•')} ${highlight('Code generation')} skipped (dry run)`);
  }

  {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'finalize.js')}`,
      `--superconnect "${paths.superconnectDir}"`,
      `--codeConnect "${paths.codeConnectDir}"`,
      `--cwd "${paths.target}"`,
      inferredFramework ? `--target-framework "${inferredFramework}"` : ''
    ].join(' ');
    runCommand(`${highlight('Finalize')}`, cmd, {
      env: {
        FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
        [agentEnvVar]: agentToken || process.env[agentEnvVar]
      }
    });
  }

  console.log(`${chalk.green('✓')} Pipeline complete.`);
}

main().catch((err) => {
  console.error(`\n❌ Pipeline failed: ${err.message}`);
  
  // Provide helpful context based on error type
  if (err.code === 'ENOENT') {
    console.error('\n💡 File not found - check that all required files exist');
    console.error('   Common causes:');
    console.error('   - Missing superconnect.toml configuration file');
    console.error('   - Missing Figma scan output files');
    console.error('   - Incorrect file paths in configuration');
  } else if (err.code === 'EACCES') {
    console.error('\n💡 Permission denied - check file/directory permissions');
  } else if (err.message.includes('FIGMA') || err.message.includes('Figma')) {
    console.error('\n💡 Figma-related error - check your FIGMA_ACCESS_TOKEN and network connection');
  } else if (err.message.includes('API') || err.message.includes('fetch')) {
    console.error('\n💡 API error - check your API keys and network connection');
  }
  
  if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
    console.error(`\nStack trace:\n${err.stack}`);
  } else {
    console.error('\nRun with SUPERCONNECT_E2E_VERBOSE=1 for full stack trace');
  }
  
  process.exit(1);
});
