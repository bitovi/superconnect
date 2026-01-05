#!/usr/bin/env node

/**
 * Build Repo Index - Generate index for fast file discovery
 *
 * Creates a pre-built metadata file (`repo-index.json`) that enables fast file discovery
 * without filesystem crawls during agentic code generation.
 *
 * Version: repo-index@1
 * Location: superconnect/repo-index.json (generated per target repo)
 *
 * ## Purpose
 *
 * In agentic mode, agents use the repo index to:
 * 1. Find candidate files by exported symbols (e.g., "which files export `Button`?")
 * 2. Filter by tags (e.g., "show me all component files")
 * 3. Resolve imports without reading every file in the repo
 * 4. Cache file reads using the stable `repoHash` for invalidation
 *
 * The index-first approach reduces filesystem I/O and LLM context by providing
 * structured metadata upfront.
 *
 * ## Schema
 *
 * ### Top-Level Fields
 *
 * - schema: string - Version identifier (repo-index@1)
 * - root: string - Absolute path to repo root
 * - generatedAt: string - ISO 8601 timestamp of index generation
 * - repoHash: string - SHA-256 hash of all file paths, sizes, and mtimes for cache invalidation
 * - maxFileBytes: number - Max file size parsed (default: 200KB)
 * - ignorePatterns: string[] - Glob patterns excluded from indexing
 * - filePatterns: string[] - Glob patterns included in indexing
 * - packageRoots: string[] - Detected package.json directories (for monorepo imports)
 * - stats: object - Summary statistics (see below)
 * - files: File[] - Array of file metadata entries
 * - exportIndex: object - Map of symbol name → file paths
 *
 * ### File Entry Schema
 *
 * Each file entry contains:
 * - path: string - Repo-relative path (POSIX format)
 * - packageRoot: string - Nearest package.json directory
 * - size: number - File size in bytes
 * - language: string - ts, tsx, js, jsx, mjs, cjs, mts, cts
 * - tags: string[] - Inferred tags (component, hook, util, theme, etc.)
 * - exports: string[] - Exported identifiers (includes "default")
 * - reexportAll: string[] - Re-export specifiers (export * from "...")
 * - importsLocal: string[] - Local import specifiers (./foo, ../bar)
 * - parseStatus: string - "parsed" | "skipped:size"
 *
 * ### Stats Object
 *
 * Summary statistics:
 * - totalFiles: number - Total files found
 * - parsedFiles: number - Files successfully parsed
 * - skippedLargeFiles: number - Files exceeding maxFileBytes
 * - byLanguage: { [language: string]: number } - Breakdown by file extension
 *
 * ### Export Index
 *
 * Fast symbol lookup: { [symbolName: string]: string[] }
 *
 * Example:
 * {
 *   "Button": ["src/components/Button.tsx", "src/index.ts"],
 *   "useTheme": ["src/hooks/useTheme.ts"],
 *   "default": ["src/App.tsx", "src/theme/index.ts"]
 * }
 *
 * ## Performance Targets
 *
 * Use the `time` command to measure:
 *
 * time node scripts/build-repo-index.js \
 *   --root /path/to/repo \
 *   --output /path/to/repo/superconnect/repo-index.json
 *
 * Look at the **total** time (wall-clock).
 *
 * ## Usage
 *
 * node scripts/build-repo-index.js --root /path/to/repo --output /path/to/index.json
 *
 * ## Field Rationale (Why Each Field Exists)
 *
 * - schema: version pin for downstream tools
 * - root/generatedAt/repoHash: provenance and cache invalidation
 * - maxFileBytes/filePatterns/ignorePatterns: make coverage explicit
 * - packageRoots: monorepo import bases
 * - stats: sanity checks for partial scans
 * - files[].path: stable identifier for tool calls
 * - files[].packageRoot: resolve import bases during codegen
 * - files[].size: pack sizing hints without storing full content
 * - files[].language: route React vs Angular heuristics
 * - files[].tags: cheap hints (component/story/theme) without file reads
 * - files[].exports/reexportAll: map symbols and barrel files (includes default)
 * - files[].importsLocal: dependency slice for context packs
 * - files[].parseStatus: signal missing or skipped parse data
 * - exportIndex: fast symbol -> file lookup for orientation and codegen
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const fg = require('fast-glob');

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/.next/**',
  '**/out/**',
  '**/storybook-static/**',
  '**/codeConnect/**',
  '**/coverage/**',
  '**/tmp/**',
  '**/.cache/**',
  '**/.history/**',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/__generated__/**',
  '**/generated/**'
];

const DEFAULT_FILE_PATTERNS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'];
const DEFAULT_MAX_FILE_BYTES = 200 * 1024;

const parseArgs = (argv) => {
  const args = argv.slice(2);
  let root = null;
  let output = null;
  let maxFileBytes = DEFAULT_MAX_FILE_BYTES;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--root' || arg === '-r') && args[i + 1]) {
      root = args[i + 1];
      i += 1;
    } else if (arg === '--output' && args[i + 1]) {
      output = args[i + 1];
      i += 1;
    } else if (arg === '--max-file-bytes' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        maxFileBytes = parsed;
      }
      i += 1;
    } else if (!arg.startsWith('-') && !root) {
      root = arg;
    }
  }

  const resolvedRoot = path.resolve(root || process.cwd());
  const resolvedOutput = output
    ? path.resolve(output)
    : path.join(resolvedRoot, 'superconnect', 'repo-index.json');

  return {
    root: resolvedRoot,
    output: resolvedOutput,
    maxFileBytes,
  };
};

const toPosix = (value) => value.split(path.sep).join('/');

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

const detectLanguage = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.jsx': 'jsx',
    '.mjs': 'mjs',
    '.cjs': 'cjs',
    '.mts': 'mts',
    '.cts': 'cts',
  };
  return map[ext] || ext.replace('.', '') || 'unknown';
};

const extractTags = (filePath) => {
  const lower = filePath.toLowerCase();
  const tags = new Set();

  if (lower.includes('/components/')) tags.add('component');
  if (lower.includes('/hooks/')) tags.add('hook');
  if (lower.includes('/utils/') || lower.includes('/util/')) tags.add('util');
  if (lower.includes('/theme/') || lower.includes('/tokens/') || lower.includes('/recipes/')) tags.add('theme');
  if (lower.includes('/icons/') || lower.includes('/icon/')) tags.add('icon');
  if (lower.includes('/styles/') || lower.includes('/style/')) tags.add('style');
  if (lower.includes('/examples/') || lower.includes('/example/') || lower.includes('/demo/')) tags.add('example');
  if (lower.includes('__tests__') || lower.includes('.test.') || lower.includes('.spec.')) tags.add('test');
  if (lower.includes('.stories.') || lower.includes('/stories/') || lower.includes('storybook')) tags.add('story');

  return Array.from(tags).sort();
};

const extractLocalImports = (source) => {
  const imports = [];
  const re = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match = re.exec(source);
  while (match) {
    imports.push(match[1]);
    match = re.exec(source);
  }
  return unique(imports.filter((spec) => spec.startsWith('.') || spec.startsWith('/')));
};

const parseExportNames = (source) => {
  const names = new Set();
  let hasDefault = false;
  const reexportAll = [];

  const defaultRe = /export\s+default\b/g;
  if (defaultRe.test(source)) {
    hasDefault = true;
  }

  const declRe = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
  let declMatch = declRe.exec(source);
  while (declMatch) {
    names.add(declMatch[1]);
    declMatch = declRe.exec(source);
  }

  const namedRe = /export\s+(?:type\s+)?{\s*([^}]+)\s*}(?:\s*from\s*['"]([^'"]+)['"])?/g;
  let namedMatch = namedRe.exec(source);
  while (namedMatch) {
    const exported = namedMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const withoutType = part.replace(/^(type|typeof)\s+/i, '');
        const normalized = withoutType.replace(/\s+as\s+/i, ' as ');
        const pieces = normalized.split(' as ');
        return (pieces[1] || pieces[0] || '').trim();
      })
      .filter(Boolean);
    exported.forEach((name) => names.add(name));
    namedMatch = namedRe.exec(source);
  }

  const exportAllRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  let exportAllMatch = exportAllRe.exec(source);
  while (exportAllMatch) {
    reexportAll.push(exportAllMatch[1]);
    exportAllMatch = exportAllRe.exec(source);
  }

  if (hasDefault) names.add('default');

  return {
    names: Array.from(names).sort(),
    reexportAll: unique(reexportAll),
  };
};

const buildPackageRoots = async (root) => {
  const packageJsons = await fg(['package.json', '**/package.json'], {
    cwd: root,
    ignore: DEFAULT_IGNORES,
    dot: false,
  });
  const dirs = packageJsons.map((rel) => toPosix(path.dirname(rel)));
  return unique(dirs).sort((a, b) => b.length - a.length);
};

const findPackageRoot = (filePath, packageRoots) => {
  for (const root of packageRoots) {
    if (root === '.') return root;
    if (filePath === root || filePath.startsWith(`${root}/`)) return root;
  }
  return null;
};

const buildIndex = async ({ root, maxFileBytes }) => {
  const [filePaths, packageRoots] = await Promise.all([
    fg(DEFAULT_FILE_PATTERNS, { cwd: root, ignore: DEFAULT_IGNORES, dot: false }),
    buildPackageRoots(root),
  ]);

  const stats = {
    totalFiles: filePaths.length,
    byLanguage: {},
    skippedLargeFiles: 0,
    parsedFiles: 0,
  };

  const files = [];
  const exportIndex = {};
  const hashParts = [];

  const processFile = async (relPath) => {
    const absolute = path.join(root, relPath);
    const stat = await fs.stat(absolute);
    const size = stat.size;
    const language = detectLanguage(relPath);
    stats.byLanguage[language] = (stats.byLanguage[language] || 0) + 1;

    const entry = {
      path: toPosix(relPath),
      packageRoot: findPackageRoot(toPosix(relPath), packageRoots),
      size,
      language,
      tags: extractTags(relPath),
      exports: [],
      reexportAll: [],
      importsLocal: [],
      parseStatus: 'skipped',
    };

    if (size <= maxFileBytes) {
      const content = await fs.readFile(absolute, 'utf8');
      const localImports = extractLocalImports(content);
      const exportInfo = parseExportNames(content);
      entry.exports = exportInfo.names;
      entry.reexportAll = exportInfo.reexportAll;
      entry.importsLocal = localImports;
      entry.parseStatus = 'parsed';
      stats.parsedFiles += 1;
      exportInfo.names.forEach((name) => {
        if (!exportIndex[name]) exportIndex[name] = [];
        exportIndex[name].push(entry.path);
      });
    } else {
      stats.skippedLargeFiles += 1;
      entry.parseStatus = 'skipped:size';
    }

    hashParts.push({
      path: entry.path,
      size: entry.size,
      mtimeMs: stat.mtimeMs,
    });

    return entry;
  };

  const concurrency = 30;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, filePaths.length) }, async () => {
    while (index < filePaths.length) {
      const current = index;
      index += 1;
      files[current] = await processFile(filePaths[current]);
    }
  });
  await Promise.all(workers);

  Object.keys(exportIndex).forEach((name) => {
    exportIndex[name] = exportIndex[name].sort();
  });

  const repoHash = crypto.createHash('sha256');
  hashParts
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((part) => {
      repoHash.update(`${part.path}|${part.size}|${part.mtimeMs}\n`);
    });

  return {
    schema: 'repo-index@1',
    root: path.resolve(root),
    generatedAt: new Date().toISOString(),
    repoHash: repoHash.digest('hex'),
    maxFileBytes,
    ignorePatterns: DEFAULT_IGNORES,
    filePatterns: DEFAULT_FILE_PATTERNS,
    packageRoots,
    stats: {
      totalFiles: stats.totalFiles,
      parsedFiles: stats.parsedFiles,
      skippedLargeFiles: stats.skippedLargeFiles,
      byLanguage: stats.byLanguage,
    },
    files,
    exportIndex,
  };
};

const main = async () => {
  const { root, output, maxFileBytes } = parseArgs(process.argv);
  const index = await buildIndex({ root, maxFileBytes });
  const serialized = `${JSON.stringify(index, null, 2)}\n`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, serialized, 'utf8');
  console.log(`Repo index written to ${output}`);
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`❌ Repo index failed: ${err.message}\n`);
    process.stderr.write(`${err.stack}\n`);
    process.exitCode = 1;
  });
}
