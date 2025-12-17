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
const { OpenAIAgentAdapter, ClaudeAgentAdapter } = require('../src/agent/agent-adapter');

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
    .option('--agent-backend <value>', 'Agent backend (openai|claude)', 'claude')
    .option('--agent-model <value>', 'Agent model for SDK backends')
    .option('--agent-max-tokens <value>', 'Max output tokens for agent responses')
    .option('--agent-base-url <value>', 'Base URL for OpenAI-compatible API (e.g., LiteLLM, Azure, vLLM)')
    .option('--agent-api-key <value>', 'API key for custom endpoint (overrides OPENAI_API_KEY env var)')
    .option('--target-framework <value>', 'Target framework hint (react|angular)')
    .option('--dry-run', 'Skip agent call and write payload preview only', false)
    .option('--fake-orienter-output <file>', 'Path to a JSONL file to use instead of calling an agent (testing only)')
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const outputPath = path.resolve(opts.output);
  const superconnectDir = path.dirname(outputPath);
  return {
    figmaIndex: path.resolve(opts.figmaIndex),
    repoSummary: path.resolve(opts.repoSummary),
    output: outputPath,
    agentLogFile: path.join(superconnectDir, 'orienter-agent.log'),
    payloadPreviewFile: path.join(superconnectDir, 'orienter-agent-payload.txt'),
    agentBackend: (opts.agentBackend || 'claude').toLowerCase(),
    agentModel: opts.agentModel || undefined,
    agentMaxTokens: parseMaxTokens(opts.agentMaxTokens),
    agentBaseUrl: opts.agentBaseUrl || undefined,
    agentApiKey: opts.agentApiKey || undefined,
    targetFramework: opts.targetFramework || null,
    dryRun: Boolean(opts.dryRun),
    fakeOrienterOutput: opts.fakeOrienterOutput ? path.resolve(opts.fakeOrienterOutput) : null
  };
};

const buildPayload = (promptText, figmaIndex, repoSummary, targetFramework = null) =>
  [
    promptText.trim(),
    '',
    'FIGMA_INDEX:',
    JSON.stringify(figmaIndex, null, 2),
    '',
    'REPO_SUMMARY:',
    JSON.stringify(repoSummary, null, 2),
    '',
    'TARGET_FRAMEWORK:',
    JSON.stringify(targetFramework || null, null, 2),
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
      logDir: config.agentLogFile,
      maxTokens,
      baseUrl: config.agentBaseUrl || undefined,
      apiKey: config.agentApiKey || undefined
    });
  }
  return new ClaudeAgentAdapter({
    model: config.agentModel || undefined,
    logDir: config.agentLogFile,
    maxTokens
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

  fs.ensureDirSync(path.dirname(config.output));
  const outputStream = fs.createWriteStream(config.output, { flags: 'w' }); // stomp existing

  const payload = buildPayload(promptText, figmaIndex, repoSummary, config.targetFramework);

  if (config.fakeOrienterOutput) {
    await fs.ensureDir(path.dirname(config.payloadPreviewFile));
    await fs.writeFile(config.payloadPreviewFile, payload, 'utf8');
    await fs.copyFile(config.fakeOrienterOutput, config.output);
    outputStream.end();
    console.log(`   Using fake orienter output from ${config.fakeOrienterOutput}`);
    console.log(`   Orientation written to ${config.output}`);
    return;
  }

  const adapter = buildAdapter(config);

  if (config.dryRun) {
    await fs.ensureDir(path.dirname(config.payloadPreviewFile));
    await fs.writeFile(config.payloadPreviewFile, payload, 'utf8');
    // leave orientation output empty for dry run observability
    outputStream.end();
    console.log(`Dry run: wrote orienter payload to ${config.payloadPreviewFile}`);
    return;
  }

  const result = await adapter.orient({
    payload,
    outputStream,
    logLabel: 'orienter'
  });
  if (result.code !== 0) {
    console.error(`❌ Orienter agent failed with code ${result.code}`);
    if (result.stderr) {
      console.error(`\n${result.stderr}`);
    }
    if (result.logFile) {
      console.error(`\n📝 Full error details written to: ${result.logFile}`);
      console.error('   Check this log file for complete diagnostic information.');
    }
    process.exit(result.code);
  }

  console.log(`   Orientation written to ${config.output}`);
}

main().catch((err) => {
  console.error(`\n❌ Orienter failed: ${err.message}`);
  
  if (err.code === 'ENOENT') {
    console.error('\n💡 File not found - check that these files exist:');
    console.error('   - superconnect/figma-components-index.json (from Figma scan)');
    console.error('   - superconnect/repo-summary.json (from repo analysis)');
    console.error('   Run the full pipeline: npx superconnect');
  } else if (err.message.includes('API') || err.message.includes('authentication')) {
    console.error('\n💡 API error - verify your ANTHROPIC_API_KEY or OPENAI_API_KEY');
  } else if (err.message.includes('JSON')) {
    console.error('\n💡 JSON parse error - check input files contain valid JSON');
  }
  
  if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  
  process.exit(1);
});
