#!/usr/bin/env node

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
const chalk = require('chalk').default;
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');

const DEFAULT_CONFIG_FILE = 'superconnect.toml';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_BACKEND = 'claude';
const DEFAULT_MAX_TOKENS = 12000;

const parseMaybeInt = (value) => {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseSimpleToml(text) {
  const result = {};
  let section = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim() || null;
      if (section && !result[section]) result[section] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const valueRaw = line.slice(eq + 1).trim();
    const valueWithoutComment = valueRaw.split('#')[0].trim();
    const unquoted = valueWithoutComment.replace(/^"(.*)"$/, '$1');
    if (section) {
      result[section][key] = unquoted;
    } else {
      result[key] = unquoted;
    }
  }
  return result;
}

function loadSuperconnectConfig(filePath = 'superconnect.toml') {
  const direct = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(direct)) return null;
  try {
    const raw = fs.readFileSync(direct, 'utf8');
    return parseSimpleToml(raw);
  } catch (err) {
    console.warn(`⚠️  Failed to load ${direct}: ${err.message}`);
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

  const toml = [
    '[inputs]',
    `figma_url = "${figmaUrl}"`,
    `component_repo_path = "${repoPath}"`,
    '',
    '[agent]',
    `max_tokens = ${maxTokens}`,
    ...agentSection,
    ''
  ].join('\n');

  const outPath = path.resolve(DEFAULT_CONFIG_FILE);
  fs.writeFileSync(outPath, toml, 'utf8');
  console.log(`${chalk.green('✓')} Wrote your configs to ${DEFAULT_CONFIG_FILE}. When you next run in this directory, we'll read from that instead.`);
  return parseSimpleToml(toml);
}

function runCommand(label, command, options = {}) {
  console.log(`${chalk.dim('•')} ${label}`);
  const { env: extraEnv, allowInterrupt = false, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: mergedEnv,
    ...rest
  });
  if (result.signal === 'SIGINT' && allowInterrupt) {
    console.warn(`⚠️  ${label} interrupted by SIGINT; continuing to finalize...`);
    return;
  }
  if (result.status !== 0) {
    console.error(`❌ ${label} failed with code ${result.status || 1}`);
    process.exit(result.status || 1);
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
    .option('--force', 'Re-run stages even if outputs exist')
    .option('--only <list>', 'Comma-separated component names/IDs (globs allowed) to include in codegen')
    .option('--exclude <list>', 'Comma-separated component names/IDs (globs allowed) to skip in codegen');
  program.parse(argv);
  const opts = program.opts();

  return {
    figmaUrl: opts.figmaUrl || undefined,
    figmaToken: opts.figmaToken,
    target: opts.target ? path.resolve(opts.target) : undefined,
    force: Boolean(opts.force),
    only: typeof opts.only === 'string' ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : [],
    exclude: typeof opts.exclude === 'string' ? opts.exclude.split(',').map((s) => s.trim()).filter(Boolean) : []
  };
}

function loadEnvToken() {
  if (process.env.FIGMA_ACCESS_TOKEN) return process.env.FIGMA_ACCESS_TOKEN;
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('FIGMA_ACCESS_TOKEN='));
  if (!line) return null;
  const [, value] = line.split('=');
  return (value || '').trim() || null;
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

  if (needRepoSummary) {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'summarize-repo.js')}`,
      `--root "${paths.target}"`,
      '>',
      `"${paths.repoSummary}"`
    ].join(' ');
    runCommand(`${highlight('Repo overview')} → ${codeColor(rel(paths.repoSummary))}`, cmd, { shell: '/bin/zsh' });
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo overview')} (skipped, ${codeColor(
        rel(paths.repoSummary)
      )} present)`
    );
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
      `--index "${paths.figmaIndex}"`
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
    const cmd = [
      `node ${path.join(paths.scriptDir, 'run-orienter.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--repo-summary "${paths.repoSummary}"`,
      `--output "${paths.orientation}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      agentConfig.maxTokens ? `--agent-max-tokens "${agentConfig.maxTokens}"` : ''
    ].join(' ');
    runCommand(`${highlight('Repo orientation')} → ${generatedColor(rel(paths.orientation))}`, cmd);
  } else {
    console.log(
      `${chalk.dim('•')} ${highlight('Repo orientation')} (skipped, ${generatedColor(
        rel(paths.orientation)
      )} already present)`
    );
  }

  {
    const codegenCmd = [
      `node ${path.join(paths.scriptDir, 'run-codegen.js')}`,
      `--figma-index "${paths.figmaIndex}"`,
      `--orienter "${paths.orientation}"`,
      `--agent-backend "${agentConfig.backend}"`,
      agentConfig.model ? `--agent-model "${agentConfig.model}"` : '',
      agentConfig.maxTokens ? `--agent-max-tokens "${agentConfig.maxTokens}"` : '',
      args.only && args.only.length ? `--only "${args.only.join(',')}"` : '',
      args.exclude && args.exclude.length ? `--exclude "${args.exclude.join(',')}"` : '',
      args.force ? '--force' : ''
    ]
      .filter(Boolean)
      .join(' ');
    runCommand(
      `${highlight('Code generation')} (${codeColor(rel(paths.orientation))} → ${generatedColor(rel(paths.codeConnectDir))})`,
      codegenCmd,
      { cwd: paths.target, allowInterrupt: true }
    );
  }

  {
    const cmd = [
      `node ${path.join(paths.scriptDir, 'finalize.js')}`,
      `--superconnect "${paths.superconnectDir}"`,
      `--codeConnect "${paths.codeConnectDir}"`,
      `--cwd "${paths.target}"`
    ].join(' ');
    runCommand(`${highlight('Finalize')} (summarizing ${generatedColor(rel(paths.superconnectDir))})`, cmd);
  }

  console.log(`${chalk.green('✓')} Pipeline complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
