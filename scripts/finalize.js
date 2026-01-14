#!/usr/bin/env node

/**
 * Finalizer: summarize a Superconnect run.
 *
 * Inputs:
 *  - superconnect-logs directory (figma-components-index.json, codegen-summaries, codegen-agent-transcripts, orientation.jsonl)
 *  - codeConnect directory (generated *.figma.tsx)
 *
 * Outputs:
 *  - Colorized summary printed to stdout
 *  - figma.config.json at repo root pointing Code Connect to generated files
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk');
const fg = require('fast-glob');

const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');
const { toTokenName } = require('../src/util/naming');
const { readJsonSafe } = require('../src/util/fs-helpers');
const stripAnsi = (value = '') => value.replace(/\u001b\[[0-9;]*m/g, '');
const METADATA_FILE_NAME = 'figma.config.json';

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

const extractFigmaTokensFromFile = (filePath) => {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const re = /<FIGMA_[A-Z0-9_]+>/g;
    const tokens = new Set();
    let match = re.exec(text);
    while (match) {
      tokens.add(match[0]);
      match = re.exec(text);
    }
    return tokens;
  } catch {
    return new Set();
  }
};

const listCodeConnectFiles = (dir) => {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const pattern = path.join(dir, '**', '*.figma.{ts,tsx}');
  return fg.sync(pattern.replace(/\\/g, '/')).map((p) => path.resolve(p));
};

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
      figmaToken: data.figmaToken || null
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
  const repoHeading = context.targetFramework
    ? `=== ${context.targetFramework.toUpperCase()} REPO SCANNING ===`
    : '=== REPO SCANNING ===';
  const figmaStatusEmoji = context.figmaCount > 0 ? '🟢' : '🔴';
  const figmaExtractStatus = context.figmaComponentsDirExists ? figmaStatusEmoji : '🟡';

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

  lines.push(codeColor(chalk.bold(repoHeading)));
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
      figmaStatusEmoji,
      `Read from Figma:`,
      figmaColor(context.figmaUrl || context.figmaFileKey || context.figmaFileName || context.figmaIndexRel)
    )
  );
  lines.push(
    formatRow(
      figmaStatusEmoji,
      `Wrote Figma index file (${context.figmaCount} components):`,
      figmaColor(context.figmaIndexRel)
    )
  );
  lines.push(
    formatRow(
      figmaExtractStatus,
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
    .option('--superconnect <dir>', 'Superconnect directory containing pipeline artifacts', 'superconnect-logs')
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
    componentLogsDir: path.join(superconnectDir, 'codegen-summaries'),
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
  const figmaComponentsDir = path.join(config.superconnectDir, 'figma-components');
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

  const builtDetails = componentLogs.filter((log) => Boolean(log.codeConnectFile));
  const skippedDetails = componentLogs.filter((log) => !log.codeConnectFile);
  
  // Warn if no components were built
  if (builtDetails.length === 0 && componentLogs.length > 0) {
    console.warn('\n⚠️  No Code Connect files were generated');
    console.warn('💡 Common reasons:');
    console.warn('   - All components failed code generation (check codegen-summaries/)');
    console.warn('   - Components were skipped due to errors in orienter stage');
    console.warn('   - API rate limits or authentication issues');
    console.warn('   Run with SUPERCONNECT_E2E_VERBOSE=1 for detailed logs\n');
  }

  const context = {
    figmaIndexRel: path.relative(config.baseCwd, config.figmaIndex) || config.figmaIndex,
    componentLogsRel: path.relative(config.baseCwd, config.componentLogsDir) || config.componentLogsDir,
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
    figmaFileKey: figmaIndex.fileKey || null,
    figmaFileName: figmaIndex.fileName || null,
    figmaUrl: figmaIndex.fileKey ? `https://www.figma.com/design/${figmaIndex.fileKey}` : null,
    repoSummaryRel:
      path.relative(config.baseCwd, path.join(config.superconnectDir, 'repo-summary.json')) || null,
    repoSummaryExists: fs.existsSync(path.join(config.superconnectDir, 'repo-summary.json')),
    figmaComponentsDirRel:
      path.relative(config.baseCwd, figmaComponentsDir) || null,
    figmaComponentsDirExists:
      fs.existsSync(figmaComponentsDir) && fs.statSync(figmaComponentsDir).isDirectory(),
    targetFramework
  };

  const summary = buildSummary(context);
  const includeGlobs = new Set();
  const sourceGlobs = ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'];
  const figmaFileUrl = figmaIndex.fileKey ? `https://www.figma.com/design/${figmaIndex.fileKey}` : null;

  const normalizeNameKey = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  const buildDocumentSubstitutions = (details, baseUrl) => {
    if (!baseUrl) return undefined;
    const substitutions = { '<FIGMA_ICONS_BASE>': baseUrl };
    const sorted = [...details].sort((a, b) => (a.figmaName || '').localeCompare(b.figmaName || ''));
    sorted.forEach((log) => {
      if (!log.figmaId || !log.figmaName) return;
      const nodeUrl = `${baseUrl}?node-id=${(log.figmaId || '').replace(/:/g, '-')}`;
      const nameToken = log.figmaToken || toTokenName(log.figmaName);
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

  const derivePackagePathAliases = (repoRoot) => {
    const packagesDir = path.join(repoRoot, 'packages');
    if (!fs.existsSync(packagesDir) || !fs.statSync(packagesDir).isDirectory()) return undefined;
    const aliases = {};
    const entries = fs.readdirSync(packagesDir);
    entries.forEach((entry) => {
      const pkgDir = path.join(packagesDir, entry);
      if (!fs.statSync(pkgDir).isDirectory()) return;
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) return;
      try {
        const pkg = fs.readJsonSync(pkgJsonPath);
        if (!pkg?.name) return;
        const srcIndexCandidates = ['index.ts', 'index.tsx', 'src/index.ts', 'src/index.tsx'].map((rel) =>
          path.join(pkgDir, rel)
        );
        const existing = srcIndexCandidates.find((p) => fs.existsSync(p));
        if (existing) {
          aliases[pkg.name] = [path.relative(repoRoot, existing).replace(/\\/g, '/')];
        }
      } catch {
        // ignore bad package.json
      }
    });
    return Object.keys(aliases).length ? aliases : undefined;
  };

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

  const aliasPaths = derivePackagePathAliases(config.baseCwd);
  if (aliasPaths) {
    metadata.codeConnect.paths = aliasPaths;
  }
  const metadataPath = path.join(config.baseCwd, METADATA_FILE_NAME);
  fs.ensureDirSync(path.dirname(metadataPath));
  await fs.writeJson(metadataPath, metadata, { spaces: 2, flag: 'w' });

  console.log(summary);

  const substitutionTokens = new Set(Object.keys(substitutions || {}));
  const tokenUsage = new Map();
  context.codegenFiles.forEach((filePathRel) => {
    const filePath = path.resolve(config.baseCwd, filePathRel);
    const tokens = extractFigmaTokensFromFile(filePath);
    tokens.forEach((token) => {
      const current = tokenUsage.get(token) || 0;
      tokenUsage.set(token, current + 1);
    });
  });

  const unmatchedTokens = Array.from(tokenUsage.keys()).filter((t) => !substitutionTokens.has(t));
  if (unmatchedTokens.length && figmaIndex?.components?.length && codeConnectConfig.documentUrlSubstitutions) {
    const byName = new Map(
      figmaIndex.components
        .map((c) => [normalizeNameKey(c.name), c])
        .filter(([key, c]) => key && c && c.id)
    );
    unmatchedTokens.forEach((token) => {
      const key = token.replace(/[<>]/g, '').replace(/^FIGMA_/, '');
      const normalized = normalizeNameKey(key);
      const match = byName.get(normalized);
      if (match && figmaFileUrl) {
        const nodeUrl = `${figmaFileUrl}?node-id=${(match.id || '').replace(/:/g, '-')}`;
        codeConnectConfig.documentUrlSubstitutions[token] = nodeUrl;
        substitutionTokens.add(token);
      }
    });
  }

  const stillUnmatched = Array.from(tokenUsage.keys()).filter((t) => !substitutionTokens.has(t));
  if (stillUnmatched.length >= 5) {
    const sample = stillUnmatched.slice(0, 5).join(', ');
    console.warn(
      chalk.yellow(
        `⚠️  Found ${stillUnmatched.length} Code Connect placeholder token(s) used in codeConnect files that do not correspond to components in this Figma file.`
      )
    );
    console.warn(
      chalk.yellow(
        `   Examples: ${sample}. You may be using a different Figma kit version than the one these mappings were originally created for.`
      )
    );
  }

  console.log(`${chalk.green('✓')} Wrote ${metadataPath}`);
}

main().catch((err) => {
  console.error(`\n❌ Finalization failed: ${err.message}`);
  
  if (err.code === 'ENOENT') {
    console.error('\n💡 File not found - ensure all previous pipeline steps completed successfully');
  } else if (err.message.includes('JSON')) {
    console.error('\n💡 JSON parse error - check that generated files contain valid JSON');
  } else if (err.message.includes('write') || err.code === 'EACCES') {
    console.error('\n💡 File write error - check permissions in output directories');
  }
  
  if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  
  process.exit(1);
});
