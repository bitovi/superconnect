#!/usr/bin/env node

/**
 * Stage 3: Orienter runner.
 *
 * Inputs (named):
 *  - --figma-index <file>: path to figma-components-index.json
 *  - --repo-summary <file>: path to repo-summary.json
 *  - --output <file>: path for orientation JSONL (default: superconnect/orientation.jsonl)
 *
 * Behavior:
 *  - Reads the orienter prompt (prompts/orienter.md)
 *  - Invokes the agent ONCE with {figma index + repo summary}
 *  - Streams agent stdout to both the orientation.jsonl output and the log
 *  - Always overwrites the output file
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const { CodexCliAgentAdapter, OpenAIAgentAdapter, ClaudeAgentAdapter } = require('../src/agent/agent-adapter');

const DEFAULT_AGENT_RUNNER = 'codex exec --model gpt-5.1-codex-mini --sandbox read-only';

const promptPath = path.join(__dirname, '..', 'prompts', 'orienter.md');
const defaultOutput = path.join(process.cwd(), 'superconnect', 'orientation.jsonl');

const readJson = (filePath) => fs.readJson(filePath);

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('run-orienter')
    .requiredOption('--figma-index <file>', 'Path to figma-components-index.json')
    .requiredOption('--repo-summary <file>', 'Path to repo-summary.json')
    .option('--output <file>', 'Orientation JSONL output path', defaultOutput)
    .option('--agent-backend <value>', 'Agent backend (cli|openai|claude)', 'cli')
    .option('--agent-model <value>', 'Agent model for SDK backends')
    .option('--agent-max-tokens <value>', 'Max output tokens for agent responses')
    .option('--agent-cli <value>', 'Agent CLI command (when backend=cli)', DEFAULT_AGENT_RUNNER)
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const outputPath = path.resolve(opts.output);
  const superconnectDir = path.dirname(outputPath);
  return {
    figmaIndex: path.resolve(opts.figmaIndex),
    repoSummary: path.resolve(opts.repoSummary),
    output: outputPath,
    agentLogDir: path.join(superconnectDir, 'orienter-agent.log'),
    agentBackend: (opts.agentBackend || 'cli').toLowerCase(),
    agentModel: opts.agentModel || undefined,
    agentMaxTokens: parseMaxTokens(opts.agentMaxTokens),
    agentCli: opts.agentCli || DEFAULT_AGENT_RUNNER
  };
};

const buildPayload = (promptText, figmaIndex, repoSummary) =>
  [
    promptText.trim(),
    '',
    'FIGMA_INDEX:',
    JSON.stringify(figmaIndex, null, 2),
    '',
    'REPO_SUMMARY:',
    JSON.stringify(repoSummary, null, 2),
    ''
  ].join('\n');

const parseMaxTokens = (value) => {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const buildAdapter = (config) => {
  const backend = config.agentBackend;
  const maxTokens = config.agentMaxTokens || undefined;
  if (backend === 'openai') {
    return new OpenAIAgentAdapter({
      model: config.agentModel || undefined,
      logDir: config.agentLogDir,
      maxTokens
    });
  } else if (backend === 'claude') {
    return new ClaudeAgentAdapter({
      model: config.agentModel || undefined,
      logDir: config.agentLogDir,
      maxTokens
    });
  }
  const runner = config.agentCli || DEFAULT_AGENT_RUNNER;
  return new CodexCliAgentAdapter({
    runner,
    logDir: config.agentLogDir
  });
};

async function main() {
  const config = parseArgs(process.argv);

  const [promptText, figmaIndex, repoSummary] = await Promise.all([
    fs.readFile(promptPath, 'utf8'),
    readJson(config.figmaIndex),
    readJson(config.repoSummary)
  ]);

  const components = Array.isArray(figmaIndex?.components) ? figmaIndex.components : [];
  if (components.length === 0) {
    console.error('❌ No components found in figma index.');
    process.exit(1);
  }

  const adapter = buildAdapter(config);

  fs.ensureDirSync(path.dirname(config.output));
  const outputStream = fs.createWriteStream(config.output, { flags: 'w' }); // stomp existing

  const payload = buildPayload(promptText, figmaIndex, repoSummary);
  const result = await adapter.orient({
    payload,
    outputStream,
    logLabel: 'orienter'
  });
  if (result.code !== 0) {
    console.error(`❌ Orienter agent failed with code ${result.code}`);
    process.exit(result.code);
  }

  console.log(`Orientation written to ${config.output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
