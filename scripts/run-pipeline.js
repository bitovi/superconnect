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
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.2-codex';
const DEFAULT_API = 'anthropic-agent-sdk';
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_ORIENTATION_MAX_TOKENS = 32768;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_LAYER_DEPTH = 3;
const DEFAULT_CONCURRENCY = 5;

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
  const rawApi = (agentSection.api || DEFAULT_API).toLowerCase();
  const api = ['openai-chat-api', 'anthropic-messages-api', 'anthropic-agent-sdk'].includes(rawApi) ? rawApi : DEFAULT_API;
  const model =
    agentSection.model ||
    (api === 'openai-chat-api'
      ? DEFAULT_OPENAI_MODEL
      : api === 'anthropic-agent-sdk'
      ? 'claude-sonnet-4-5'
      : DEFAULT_ANTHROPIC_MODEL);
  const maxTokens = parseMaybeInt(agentSection.max_tokens);
  const resolvedMaxTokens = (api === 'anthropic-messages-api' || api === 'anthropic-agent-sdk') ? maxTokens || DEFAULT_MAX_TOKENS : maxTokens || null;
  
  // Custom OpenAI-compatible endpoints (LiteLLM, Azure, vLLM, etc.)
  const baseUrl = agentSection.llm_proxy_url || null;
  const apiKey = agentSection.api_key || null;
  
  // Warn if llm_proxy_url is set with non-OpenAI api
  if (baseUrl && api !== 'openai-chat-api') {
    console.warn(
      `${chalk.yellow('⚠️  llm_proxy_url is set but api is "')}${api}${chalk.yellow('". llm_proxy_url is only used with api = "openai-chat-api".')}\n` +
      `   ${chalk.yellow('Did you mean to set api = "openai-chat-api"?')}`
    );
  }
  
  // Warn if using custom llm_proxy_url without explicitly setting model
  if (baseUrl && !agentSection.model) {
    console.warn(
      `${chalk.yellow('⚠️  Using custom llm_proxy_url but no model specified.')}\n` +
      `   ${chalk.yellow(`Default model "${DEFAULT_OPENAI_MODEL}" may not exist on your endpoint.`)}\n` +
      `   ${chalk.dim('Add to superconnect.toml: model = "your-model-name"')}`
    );
  }
  
  return { api, model, maxTokens: resolvedMaxTokens, baseUrl, apiKey };
}

/**
 * Normalize [codegen] section from TOML config.
 * @param {object} codegenSection - The [codegen] section from TOML
 * @returns {{ maxRetries: number, concurrency: number, outputDir: string|null }}
 */
function normalizeCodegenConfig(codegenSection = {}) {
  const maxRetries = parseMaybeInt(codegenSection.max_retries) ?? DEFAULT_MAX_RETRIES;
  const concurrency = parseMaybeInt(codegenSection.concurrency) ?? DEFAULT_CONCURRENCY;
  const outputDir = codegenSection.code_connect_output_dir || null;
  const colocation = codegenSection.colocation !== undefined ? Boolean(codegenSection.colocation) : true;
  return { maxRetries, concurrency, outputDir, colocation };
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

  console.log(`\n${chalk.bold('Agent API Configuration')}`);
  console.log(`${chalk.dim('Choose which AI service to use for code generation')}`);
  
  const apiInput = await question(
    `${chalk.cyan('Agent API')} (${chalk.dim('anthropic')} or openai) [${chalk.dim(DEFAULT_API)}]: `
  );
  const api = (apiInput || DEFAULT_API).toLowerCase();
  const normalizedApi = api === 'openai' || api === 'anthropic' ? api : DEFAULT_API;

  let baseUrl = null;
  let apiKey = null;
  
  if (normalizedApi === 'openai') {
    console.log(`\n${chalk.dim('OpenAI-compatible endpoints: LiteLLM, Azure OpenAI, vLLM, LocalAI, etc.')}`);
    const baseUrlInput = await question(
      `${chalk.cyan('Custom base URL')} (optional, press Enter to use api.openai.com): `
    );
    if (baseUrlInput) {
      baseUrl = baseUrlInput;
      console.log(`${chalk.dim('Using custom endpoint:')} ${baseUrl}`);
      
      const apiKeyInput = await question(
        `${chalk.cyan('Custom API key')} (optional, press Enter to use OPENAI_API_KEY env var): `
      );
      if (apiKeyInput) {
        apiKey = apiKeyInput;
      }
    }
  }

  rl.close();

  const active = normalizedApi;
  const chooseModel = (a) => {
    if (a === 'openai') return DEFAULT_OPENAI_MODEL;
    return DEFAULT_ANTHROPIC_MODEL;
  };
  const model = chooseModel(active);
  const maxTokens = DEFAULT_MAX_TOKENS;

  const agentSection = [];
  
  if (active === 'anthropic-messages-api' || active === 'anthropic-agent-sdk') {
    const apiValue = active === 'anthropic-agent-sdk' ? 'anthropic-agent-sdk' : 'anthropic-messages-api';
    agentSection.push(
      '# Backend for code generation:',
      '#   "anthropic-agent-sdk"     (default) — Claude explores your codebase using tools',
      '#   "anthropic-messages-api"  — Anthropic Messages API (curated context)',
      '#   "openai-chat-api"        — OpenAI Chat Completions API or compatible provider',
      `api = "${apiValue}"`,
      `model = "${model}"`,
      '',
      '# Alternative backends:',
      '#   api = "anthropic-messages-api"   # Messages API (deterministic context)',
      '#   api = "openai-chat-api"',
      `#   model = "${DEFAULT_OPENAI_MODEL}"`,
      '#   llm_proxy_url = "http://localhost:4000/v1"  # LiteLLM, Azure, vLLM, LocalAI'
    );
  } else if (active === 'openai-chat-api') {
    const lines = [
      '# AI provider: "anthropic-agent-sdk" (default) or "openai-chat-api"',
      '# Anthropic requires ANTHROPIC_API_KEY env var',
      '# OpenAI requires OPENAI_API_KEY env var (or use llm_proxy_url for LiteLLM, Azure, etc.)',
      'api = "openai-chat-api"',
      `model = "${model}"`
    ];
    if (baseUrl) {
      lines.push(`llm_proxy_url = "${baseUrl}"`);
    }
    }
    if (apiKey) {
      lines.push(`api_key = "${apiKey}"`);
    }
    lines.push(
      '',
      '# To use Anthropic instead, comment out the above and uncomment:',
      '# api = "anthropic"',
      `# model = "${DEFAULT_ANTHROPIC_MODEL}"`
    );
    agentSection.push(...lines);
  }

  const tomlContent = [
    '# Superconnect configuration',
    '# Docs: https://github.com/bitovi/superconnect#readme',
    '',
    '[inputs]',
    `figma_file_url = "${figmaUrl}"`,
    `component_repo_path = "${repoPath}"`,
    '# Also requires FIGMA_ACCESS_TOKEN env var',
    '',
    '[agent]',
    ...agentSection,
    '',
    '[codegen]',
    '# How many times to retry if generated code fails validation (0-10)',
    'max_retries = 4',
    '',
    '# Number of components to process in parallel (1-16)',
    '# Higher = faster, but may cause errors with some LLM proxies (LiteLLM, Bedrock, etc.)',
    '# If you see 503/rate-limit errors, try lowering this to 1',
    'concurrency = 5',
    '',
    '# Place Code Connect files next to source components (default: true)',
    '# When true: Button.tsx → Button.figma.tsx in same directory',
    '# When false: all files go to code_connect_output_dir',
    '# colocation = true',
    '',
    '# Where to write Code Connect files when colocation = false (default: codeConnect/)',
    '# code_connect_output_dir = "codeConnect"',
    '',
    '[figma]',
    "# How deep to scan Figma's component tree. Increase if nested variants aren't detected.",
    '# layer_depth = 3',
    ''
  ].join('\n');

  const outPath = path.resolve(DEFAULT_CONFIG_FILE);
  fs.writeFileSync(outPath, tomlContent, 'utf8');
  console.log(`${chalk.green('✓')} Wrote your configs to ${DEFAULT_CONFIG_FILE}. When you next run in this directory, we'll read from that instead.`);
  return toml.parse(tomlContent);
}

/**
 * Run a Node.js script directly without spawning a shell.
 * This avoids Windows PowerShell issues where cmd.exe as an intermediary
 * can interfere with console output and ANSI color codes.
 * 
 * @param {string} label - Display label for the command
 * @param {string} scriptPath - Absolute path to the Node.js script
 * @param {string[]} args - Array of arguments to pass to the script
 * @param {object} options - Options (env, cwd, allowInterrupt)
 */
function runNodeScript(label, scriptPath, args = [], options = {}) {
  console.log(`${chalk.dim('•')} ${label}`);
  const { env: extraEnv, allowInterrupt = false, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  const shouldCapture = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPERCONNECT_E2E_VERBOSE || '').toLowerCase());
  
  // Call Node.js directly without shell - more reliable cross-platform
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: shouldCapture ? 'pipe' : 'inherit',
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
      console.error(`Script: ${scriptPath}`);
      console.error(`Args: ${JSON.stringify(args)}`);
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

/**
 * Get version string with git SHA if available
 */
function getVersionString() {
  const semver = require('../package.json').version;
  
  // First try reading from baked-in SHA file (for npm installs)
  try {
    const shaFile = path.join(__dirname, '..', '.version-sha');
    if (fs.existsSync(shaFile)) {
      const sha = fs.readFileSync(shaFile, 'utf8').trim();
      if (sha) return `${semver} (${sha})`;
    }
  } catch {}
  
  // Fall back to git command (for dev environments)
  try {
    const { execSync } = require('child_process');
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return `${semver} (${sha})`;
  } catch {
    return semver;
  }
}

function parseArgv(argv) {
  const program = new Command();
  program
    .name('run-pipeline')
    .version(getVersionString())
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
  const superconnectDir = path.join(target, 'superconnect-logs');
  const figmaDir = path.join(superconnectDir, 'figma-components');
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  const repoSummary = path.join(superconnectDir, 'repo-summary.json');
  const orientation = path.join(superconnectDir, 'orientation.jsonl');
  const agentLogDir = path.join(superconnectDir, 'orienter-agent.log');
  const codegenTranscriptDir = path.join(superconnectDir, 'codegen-agent-transcripts');
  // Use config.outputDir if set, otherwise default to 'codeConnect'
  const codeConnectDir = config.outputDir 
    ? path.resolve(target, config.outputDir)
    : path.join(target, 'codeConnect');
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
    codegenTranscriptDir,
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
  const prospectiveFigmaIndex = path.join(prospectiveTarget, 'superconnect-logs', 'figma-components-index.json');
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
  const figmaUrl = args.figmaUrl || cfg.inputs?.figma_file_url || undefined;
  const target =
    args.target ||
    (cfg.inputs?.component_repo_path ? path.resolve(cfg.inputs.component_repo_path) : path.resolve('.'));
  const figmaToken = args.figmaToken || loadEnvToken();
  const agentConfig = normalizeAgentConfig(cfg.agent || {});
  const codegenConfig = normalizeCodegenConfig(cfg.codegen || {});
  const figmaConfig = normalizeFigmaConfig(cfg.figma || {});
  const agentEnvVar = agentConfig.api === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const agentToken = agentConfig.apiKey || loadAgentToken(agentConfig.api);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`❌ Target repo not found or not a directory: ${target}`);
    process.exit(1);
  }
  const paths = resolvePaths({ ...args, figmaUrl, target, figmaToken, outputDir: codegenConfig.outputDir, colocation: codegenConfig.colocation });

  const agentLabel =
    agentConfig.api === 'openai-chat-api'
      ? `openai-chat-api${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`
      : agentConfig.api === 'anthropic-agent-sdk'
      ? `anthropic-agent-sdk${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`
      : `anthropic-messages-api${agentConfig.model ? ` (model ${agentConfig.model})` : ''}`;
  console.log(`${chalk.dim('•')} ${highlight('Agent API')}: ${highlight(agentLabel)}`);

  fs.ensureDirSync(paths.superconnectDir);
  fs.ensureDirSync(paths.figmaDir);

  const needFigmaScan = args.force || !fs.existsSync(paths.figmaIndex);
  const needRepoSummary = args.force || !fs.existsSync(paths.repoSummary);
  const needOrientation = args.force || !fs.existsSync(paths.orientation);
  const rel = (p) => path.relative(process.cwd(), p) || p;

  const needsAgent = !args.dryRun;
  if (needsAgent && !agentToken) {
    if (agentConfig.apiKey) {
      console.error(`❌ API key from superconnect.toml appears to be empty or invalid.`);
      console.error(`   Check the api_key field in [agent] section, or set ${agentEnvVar} in your environment.`);
    } else {
      console.error(`❌ ${agentEnvVar} is required to run agent-backed stages (${agentConfig.api}).`);
      console.error(`   Set ${agentEnvVar} in your environment or .env, add api_key to superconnect.toml, or switch to --dry-run.`);
    }
    process.exit(1);
  }

  if (needRepoSummary) {
    runNodeScript(
      `${highlight('Repo overview')} → ${codeColor(rel(paths.repoSummary))}`,
      path.join(paths.scriptDir, 'summarize-repo.js'),
      ['--root', paths.target]
    );
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
    const figmaScanArgs = [
      paths.figmaUrl,
      '--token', figmaToken || '',
      '--output', paths.figmaDir,
      '--index', paths.figmaIndex,
      '--layer-depth', String(figmaConfig.layerDepth)
    ];
    runNodeScript(
      `${highlight('Figma scan')} → ${figmaColor(rel(paths.figmaIndex))}`,
      path.join(paths.scriptDir, 'figma-scan.js'),
      figmaScanArgs
    );
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
    const orienterArgs = [
      '--figma-index', paths.figmaIndex,
      '--repo-summary', paths.repoSummary,
      '--output', paths.orientation,
      '--agent-api', agentConfig.api,
      ...(agentConfig.model ? ['--agent-model', agentConfig.model] : []),
      '--agent-max-tokens', String(orientationMaxTokens),
      ...(agentConfig.baseUrl ? ['--agent-base-url', agentConfig.baseUrl] : []),
      ...(agentConfig.apiKey ? ['--agent-api-key', agentConfig.apiKey] : []),
      ...(inferredFramework ? ['--target-framework', inferredFramework] : []),
      ...(args.dryRun ? ['--dry-run'] : [])
    ];
    runNodeScript(
      `${highlight('Repo orientation')} → ${generatedColor(rel(paths.orientation))}`,
      path.join(paths.scriptDir, 'run-orienter.js'),
      orienterArgs,
      {
        env: {
          FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
          [agentEnvVar]: agentToken || process.env[agentEnvVar]
        }
      }
    );
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo orientation')} (skipped, ${generatedColor(
        rel(paths.orientation)
      )} already present)`
    );
  }

  if (!args.dryRun) {
    const codegenArgs = [
      '--figma-index', paths.figmaIndex,
      '--orienter', paths.orientation,
      '--repo-summary', paths.repoSummary,
      '--agent-api', agentConfig.api,
      ...(agentConfig.model ? ['--agent-model', agentConfig.model] : []),
      ...(agentConfig.maxTokens ? ['--agent-max-tokens', String(agentConfig.maxTokens)] : []),
      ...(agentConfig.baseUrl ? ['--agent-base-url', agentConfig.baseUrl] : []),
      ...(agentConfig.apiKey ? ['--agent-api-key', agentConfig.apiKey] : []),
      '--concurrency', String(codegenConfig.concurrency),
      ...(args.only && args.only.length ? ['--only', args.only.join(',')] : []),
      ...(args.exclude && args.exclude.length ? ['--exclude', args.exclude.join(',')] : []),
      ...(inferredFramework ? ['--target-framework', inferredFramework] : []),
      ...(args.force ? ['--force'] : [])
    ];
    runNodeScript(
      `${highlight('Code generation')} (${codeColor(rel(paths.orientation))} → ${generatedColor(rel(paths.codeConnectDir))})`,
      path.join(paths.scriptDir, 'run-codegen.js'),
      codegenArgs,
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
    const finalizeArgs = [
      '--superconnect', paths.superconnectDir,
      '--codeConnect', paths.codeConnectDir,
      '--cwd', paths.target,
      ...(inferredFramework ? ['--target-framework', inferredFramework] : [])
    ];
    runNodeScript(
      `${highlight('Finalize')}`,
      path.join(paths.scriptDir, 'finalize.js'),
      finalizeArgs,
      {
        env: {
          FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
          [agentEnvVar]: agentToken || process.env[agentEnvVar]
        }
      }
    );
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
