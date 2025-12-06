#!/usr/bin/env node

/**
 * Finalizer: summarize a Superconnect run.
 *
 * Inputs:
 *  - superconnect directory (figma-components-index.json, codegen-logs, mapping-agent-logs, orientation.jsonl)
 *  - codeConnect directory (generated *.figma.tsx)
 *
 * Outputs:
 *  - Colorized summary printed to stdout
 *  - figma.config.json at repo root pointing Code Connect to generated files
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const { generate } = require('fast-glob/out/managers/tasks');
const chalk = require('chalk').default;

const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');
const stripAnsi = (value = '') => value.replace(/\u001b\[[0-9;]*m/g, '');
const METADATA_FILE_NAME = 'figma.config.json';

const readJsonSafe = (filePath) => fs.readJson(filePath).catch(() => null);

const readJsonLines = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const listCodeConnectFiles = (dir) => {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.figma.ts') || f.endsWith('.figma.tsx'))
    .map((f) => path.join(dir, f));
};

const toTokenName = (value) =>
  `<FIGMA_${(value || 'node')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}>`;

const VALUE_COL = 50;

const formatRow = (statusEmoji, label, value, indent = '') => {
  const target = Math.max(0, VALUE_COL - indent.length - 3); // emoji + space + space before value
  const visible = stripAnsi(label);
  const pad = Math.max(0, target - visible.length);
  const padded = `${label}${' '.repeat(pad)}`;
  return `${indent}${statusEmoji} ${chalk.bold(padded)} ${value}`;
};

const continuationRow = (indent = '', value = '') => {
  const pad = Math.max(0, VALUE_COL - indent.length - 3);
  return `${indent}${' '.repeat(pad + 3)}${value}`;
};

const readComponentLogs = async (dir) => {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({ file, full: path.join(dir, file) }));

  const results = [];
  for (const entry of entries) {
    const data = await readJsonSafe(entry.full);
    if (!data) continue;
    results.push({
      file: entry.file,
      figmaName: data.figmaName || null,
      figmaId: data.figmaId || null,
      status: data.status || null,
      reactName: data.reactComponentName || null,
      reason: data.reason || null,
      codeConnectFile: data.codeConnectFile || null,
      confidence: data.confidence ?? null
    });
  }
  return results;
};

const buildSummary = (context) => {
  const lines = [];
  const scanStatus =
    context.orientationMapped >= context.figmaCount && context.figmaCount > 0
      ? '🟢 (complete)'
      : context.orientationMapped > 0
      ? '🟡 (partial)'
      : '🔴 (failed)';
  const codegenStatus =
    context.builtCount >= context.orientationMapped && context.orientationMapped > 0
      ? '🟢 (complete)'
      : context.builtCount > 0
      ? '🟡 (partial)'
      : '🔴 (failed)';

  lines.push('');
  lines.push(highlight('====== SUPERCONNECT RUN SUMMARY ======'));
  lines.push('');
  lines.push(
    formatRow(
      context.targetFramework ? '🟢' : '🟡',
      'Target framework:',
      context.targetFramework ? highlight(context.targetFramework) : chalk.dim('(unknown)')
    )
  );
  lines.push('');

  lines.push(codeColor(chalk.bold('=== REACT REPO SCANNING ===')));
  lines.push(
    formatRow(
      context.repoSummaryExists ? '🟢' : '🟡',
      'Generated repo overview:',
      codeColor(context.repoSummaryRel || '(not found)')
    )
  );
  lines.push('');

  lines.push(figmaColor(chalk.bold('=== FIGMA SCANNING ===')));
  lines.push(
    formatRow(
      '🟢',
      `Read from Figma:`,
      figmaColor(context.figmaUrl || context.figmaFileKey || context.figmaFileName || context.figmaIndexRel)
    )
  );
  lines.push(
    formatRow(
      '🟢',
      `Wrote Figma index file (${context.figmaCount} components):`,
      figmaColor(context.figmaIndexRel)
    )
  );
  lines.push(
    formatRow(
      '🟢',
      `Wrote extracts for ${context.figmaCount} Figma components:`,
      figmaColor(context.figmaComponentsDirRel || '(not found)')
    )
  );
  lines.push('');

  lines.push(generatedColor(chalk.bold('=== CODE GENERATION SUMMARY ===')));
  lines.push(
    formatRow(
      context.orientationMapped >= context.figmaCount
        ? '🟢'
        : context.orientationMapped > 0
        ? '🟡'
        : '🔴',
      `Generated orientation info for ${highlight(context.orientationMapped)}/${highlight(context.figmaCount)}:`,
      generatedColor(context.orientationRel)
    )
  );
  const agentRuns = context.builtCount + context.skippedCount;
  lines.push(
    formatRow(
      '🟢',
      `${highlight(agentRuns)} code generation agents ran, logs at:`,
      generatedColor(context.codegenLogsRel)
    )
  );
  lines.push(
    formatRow('🟢', `${highlight(agentRuns)} code generation results at:`, generatedColor(context.componentLogsRel))
  );
  lines.push(`🟢 ${highlight(context.builtDetails.length)} Code Connect files generated:`);
  if (context.builtDetails.length) {
    const longestName = Math.max(...context.builtDetails.map((item) => (item.figmaName || '').length), 0);
    const formatted = context.builtDetails.map((item) => {
      const name = item.figmaName || '';
      const target = item.codeConnectFile || '(not written)';
      const react = item.reactName ? codeColor(` (maps to React: ${item.reactName})`) : '';
      const paddedNameRaw = name.padEnd(longestName + 1);
      const leftRaw = `${paddedNameRaw}→ ${target}`;
      const left = `${generatedColor(paddedNameRaw)}→ ${generatedColor(target)}`;
      return { leftRaw, left, react };
    });
    const longestLeft = Math.max(...formatted.map((item) => item.leftRaw.length), 0);
    formatted.forEach(({ leftRaw, left, react }) => {
      const gap = longestLeft - leftRaw.length;
      const spacer = gap > 0 ? ' '.repeat(gap) : '';
      lines.push(`    - ${left}${spacer}${react}`);
    });
  } else {
    lines.push('    - (none)');
  }
  lines.push(`🟡 Declined to codegen for ${highlight(context.skippedDetails.length)} component candidates:`);
  if (context.skippedDetails.length) {
    context.skippedDetails.forEach((item) => {
      const name = item.figmaName || item.file || '(unknown)';
      const reason = item.reason ? chalk.dim(` — ${item.reason}`) : '';
      lines.push(`    - ${highlight(name)}${reason}`);
    });
  } else {
    lines.push('    - (none)');
  }

  return lines.join('\n');
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('finalize')
    .option('--superconnect <dir>', 'Superconnect directory containing pipeline artifacts', 'superconnect')
    .option('--codeConnect <dir>', 'CodeConnect directory', 'codeConnect')
    .option('--cwd <dir>', 'Working directory to resolve paths from', '.')
    .option('--target-framework <value>', 'Target framework hint (react|angular)')
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const baseCwd = path.resolve(opts.cwd || '.');
  const superconnectDir = path.resolve(baseCwd, opts.superconnect);
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  return {
    figmaIndex,
    orientation: path.join(superconnectDir, 'orientation.jsonl'),
    codeConnectDir: path.resolve(baseCwd, opts.codeConnect),
    componentLogsDir: path.join(superconnectDir, 'codegen-logs'),
    codegenLogsDir: path.join(superconnectDir, 'mapping-agent-logs'),
    superconnectDir,
    baseCwd,
    targetFramework: opts.targetFramework || null
  };
};

async function main() {
  const config = parseArgs(process.argv);
  const figmaIndex = await readJsonSafe(config.figmaIndex);
  if (!figmaIndex) {
    console.error(`❌ Cannot read figma index at ${config.figmaIndex}`);
    process.exit(1);
  }

  const orientationEntries = await readJsonLines(config.orientation);
  const componentLogsRaw = await readComponentLogs(config.componentLogsDir);
  const repoSummaryPath = path.join(config.superconnectDir, 'repo-summary.json');
  const repoSummary = await readJsonSafe(repoSummaryPath);
  const targetFramework = config.targetFramework || repoSummary?.primary_framework || null;
  const orientationIdSet = new Set(
    orientationEntries
      .map((e) => e.figmaComponentId || e.figma_component_id || null)
      .filter(Boolean)
  );
  const orientationNameSet = new Set(
    orientationEntries
      .map((e) => e.figmaComponentName || e.figma_component_name || e.canonicalName || null)
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );
  const componentLogs = componentLogsRaw.filter((log) => {
    if (log.figmaId && orientationIdSet.has(log.figmaId)) return true;
    if (log.figmaName && orientationNameSet.has(log.figmaName.toLowerCase())) return true;
    if (log.codeConnectFile) return true;
    return false;
  });
  const codegenFiles = listCodeConnectFiles(config.codeConnectDir);
  const codegenLogsPresent =
    fs.existsSync(config.codegenLogsDir) &&
    fs.statSync(config.codegenLogsDir).isDirectory() &&
    fs.readdirSync(config.codegenLogsDir).length > 0;

  const builtDetails = componentLogs.filter((log) => Boolean(log.codeConnectFile));
  const skippedDetails = componentLogs.filter((log) => !log.codeConnectFile);

  const context = {
    figmaIndexRel: path.relative(config.baseCwd, config.figmaIndex) || config.figmaIndex,
    componentLogsRel: path.relative(config.baseCwd, config.componentLogsDir) || config.componentLogsDir,
    codegenLogsRel: path.relative(config.baseCwd, config.codegenLogsDir) || config.codegenLogsDir,
    codeConnectRel: path.relative(config.baseCwd, config.codeConnectDir) || config.codeConnectDir,
    orientationRel: path.relative(config.baseCwd, config.orientation) || config.orientation,
    figmaCount: Array.isArray(figmaIndex.components) ? figmaIndex.components.length : 0,
    orientationTotal: orientationEntries.length,
    orientationMapped: orientationEntries.filter((e) => e.status === 'mapped').length,
    builtCount: builtDetails.length,
    skippedCount: skippedDetails.length,
    builtDetails,
    skippedDetails,
    codegenFiles: codegenFiles.map((f) => path.relative(config.baseCwd, f) || f),
    codegenLogsPresent,
    figmaFileKey: figmaIndex.fileKey || null,
    figmaFileName: figmaIndex.fileName || null,
    figmaUrl: figmaIndex.fileKey ? `https://www.figma.com/design/${figmaIndex.fileKey}` : null,
    repoSummaryRel:
      path.relative(config.baseCwd, path.join(config.superconnectDir, 'repo-summary.json')) || null,
    repoSummaryExists: fs.existsSync(path.join(config.superconnectDir, 'repo-summary.json')),
    figmaComponentsDirRel:
      path.relative(config.baseCwd, path.join(config.superconnectDir, 'figma-components')) || null,
    targetFramework
  };

  const summary = buildSummary(context);
  const includeGlobs = new Set();
  const sourceGlobs = ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'];
  const figmaFileUrl = figmaIndex.fileKey ? `https://www.figma.com/design/${figmaIndex.fileKey}` : null;

  const buildDocumentSubstitutions = (details, baseUrl) => {
    if (!baseUrl) return undefined;
    const substitutions = { '<FIGMA_ICONS_BASE>': baseUrl };
    const sorted = [...details].sort((a, b) => (a.figmaName || '').localeCompare(b.figmaName || ''));
    sorted.forEach((log) => {
      if (!log.figmaId || !log.figmaName) return;
      const nodeUrl = `${baseUrl}?node-id=${(log.figmaId || '').replace(/:/g, '-')}`;
      const nameToken = toTokenName(log.figmaName);
      substitutions[nameToken] = nodeUrl;
    });
    return substitutions;
  };

  const frameworks = (repoSummary && Array.isArray(repoSummary.frameworks) && repoSummary.frameworks) || [];
  if (targetFramework === 'angular' || frameworks.includes('angular')) {
    includeGlobs.add('codeConnect/**/*.figma.ts');
  }
  if (!includeGlobs.size && (targetFramework === 'react' || frameworks.includes('react'))) {
    includeGlobs.add('codeConnect/**/*.figma.tsx');
  }
  if (!includeGlobs.size) {
    includeGlobs.add('codeConnect/**/*.figma.tsx');
  }

  const codeConnectConfig = {
    include: [...includeGlobs, ...sourceGlobs],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    parser: targetFramework === 'angular' ? 'html' : 'react',
    label: targetFramework === 'angular' ? 'angular' : 'react'
  };
  if (figmaFileUrl) {
    codeConnectConfig.interactiveSetupFigmaFileUrl = figmaFileUrl;
  }
  const substitutions = buildDocumentSubstitutions(builtDetails, figmaFileUrl);
  if (substitutions) {
    codeConnectConfig.documentUrlSubstitutions = substitutions;
  }

  const metadata = {
    schemaVersion: 1,
    codeConnect: codeConnectConfig
  };
  const metadataPath = path.join(config.baseCwd, METADATA_FILE_NAME);
  fs.ensureDirSync(path.dirname(metadataPath));
  await fs.writeJson(metadataPath, metadata, { spaces: 2, flag: 'w' });

  console.log(summary);
  console.log(`${chalk.green('✓')} Wrote ${metadataPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
