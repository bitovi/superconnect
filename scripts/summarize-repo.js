#!/usr/bin/env node

/**
 * Summarize a repo for the codegen agent.
 *
 * Usage:
 *   node scripts/summarize-repo.js --root /path/to/repo
 *   node scripts/summarize-repo.js /path/to/repo   (positional also allowed)
 *
 * Output: JSON to stdout with key paths and file counts.
 * No external CLIs required; uses built-in Node + fast-glob.
 */

const fs = require('fs/promises');
const path = require('path');
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
  // Ignore generated & type files
  '**/*.d.ts',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/__generated__/**',
  '**/generated/**'
];

const parseArgs = (argv) => {
  const args = argv.slice(2);
  let flagRoot = null;
  let positionalRoot = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--root' || arg === '-r') && args[i + 1]) {
      flagRoot = args[i + 1];
      i += 1;
    } else if (!arg.startsWith('-') && positionalRoot === null) {
      positionalRoot = arg;
    }
  }
  const root = flagRoot || positionalRoot || process.cwd();
  return { root: path.resolve(root) };
};

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

const pathExists = async (candidate) => {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
};

const listMatches = async (patterns, { cwd, onlyDirectories = false, limit = null }) => {
  const matches = await fg(patterns, {
    cwd,
    ignore: DEFAULT_IGNORES,
    onlyDirectories,
    dot: false,
  });
  const unique = Array.from(new Set(matches));
  return limit ? unique.slice(0, limit) : unique;
};

const countFiles = async (pattern, { cwd }) => {
  const matches = await fg(pattern, { cwd, ignore: DEFAULT_IGNORES });
  return matches.length;
};

const summarizePackageJson = async (root) => {
  const pkgPath = path.join(root, 'package.json');
  const pkg = await readJsonIfExists(pkgPath);
  if (!pkg) return null;
  const { name, version, workspaces, scripts } = pkg;
  return {
    path: 'package.json',
    name: name || null,
    version: version || null,
    workspaces: workspaces || null,
    scripts: scripts || null,
  };
};

const summarizeTsconfigs = async (root) => {
  const all = await listMatches(['tsconfig.json', 'tsconfig.*.json', '**/tsconfig.json'], { cwd: root, limit: 50 });
  const primary = all.find((p) => p === 'tsconfig.json') || null;
  return { primary, all };
};

const summarizeCodeConnect = async (root) => {
  const configs = await listMatches(['figma.config.json', '**/figma.config.json'], { cwd: root, limit: 20 });
  const files = await listMatches(['**/*.figma.tsx'], { cwd: root, limit: 20 });
  return {
    config: configs,
    files: {
      count: await countFiles('**/*.figma.tsx', { cwd: root }),
      samples: files,
    },
  };
};

const summarizeComponentRoots = async (root) => {
  const rootPatterns = [
    'src/components',
    'packages/*/src/components',
    'apps/*/src/components',
    'packages/react/src/components',
  ];
  const dirs = await listMatches(rootPatterns, { cwd: root, onlyDirectories: true, limit: 50 });
  const entries = [];
  for (const dir of dirs) {
    const tsxCount = await countFiles(`${dir}/**/*.{tsx,ts}`, { cwd: root });
    entries.push({ path: dir, tsxCount });
  }
  return entries;
};

const summarizeThemes = async (root) => {
  const recipeDirs = await listMatches(['src/theme/recipes', 'packages/*/src/theme/recipes'], {
    cwd: root,
    onlyDirectories: true,
    limit: 20,
  });
  return { recipes: recipeDirs };
};

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const extractExports = (source) => {
  const withoutComments = stripComments(source);
  const names = new Set();
  const declPattern =
    /export\s+(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
  const namedPattern = /export\s*{\s*([^}]+)\s*}/g;
  const defaultPattern = /export\s+default\s+(?:function|class)?\s*([A-Za-z0-9_]+)?/g;

  let match = declPattern.exec(withoutComments);
  while (match) {
    names.add(match[1]);
    match = declPattern.exec(withoutComments);
  }

  match = namedPattern.exec(withoutComments);
  while (match) {
    const parts = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      const [, alias = null] = part.split(/\s+as\s+/i);
      names.add((alias || part).trim());
    }
    match = namedPattern.exec(withoutComments);
  }

  match = defaultPattern.exec(withoutComments);
  while (match) {
    names.add(match[1] || 'default');
    match = defaultPattern.exec(withoutComments);
  }

  return Array.from(names);
};

const createSnippet = (content) => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  const snippetLines = lines.slice(0, 2).map((line) => line.trim());
  return snippetLines.join('\n');
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = [];
  let index = 0;
  const runner = async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(workers);
  return results;
};

const summarizeTsFiles = async (root, componentRoots = [], themeRecipeDirs = []) => {
  const fileRoots = [
    ...componentRoots.map((entry) => entry.path),
    ...themeRecipeDirs,
  ]
    .map((dir) => dir.replace(/\\/g, '/').replace(/\/$/, ''))
    .filter(Boolean);

  if (fileRoots.length === 0) return [];

  const discovered = new Set();
  const patternsForRoot = (base) => [`${base}/**/*.ts`, `${base}/**/*.tsx`];

  for (const base of fileRoots) {
    const matches = await fg(patternsForRoot(base), {
      cwd: root,
      ignore: [...DEFAULT_IGNORES, '**/*.d.ts'],
      dot: false,
    });
    matches.forEach((m) => discovered.add(m));
  }

  const tsFiles = Array.from(discovered).sort();

  const processFile = async (relPath) => {
    const absolutePath = path.join(root, relPath);
    const [stat, content] = await Promise.all([fs.stat(absolutePath), fs.readFile(absolutePath, 'utf8')]);
    const exports = extractExports(content);
    return {
      path: relPath,
      exports,
    };
  };

  return runWithConcurrency(tsFiles, 20, processFile);
};

const summarizeLocks = async (root) => {
  const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  const present = [];
  for (const lock of locks) {
    if (await pathExists(path.join(root, lock))) present.push(lock);
  }
  return present;
};

const summarizeEnv = async (root) => {
  const files = await listMatches(['.env', '.env.*', '.env-rename', '.env-example', '.env.example'], {
    cwd: root,
    limit: 20,
  });
  return files;
};

const summarizeConfigs = async (root) => {
  const patterns = [
    'eslint.config.*',
    '.eslintrc*',
    'vite.config.*',
    'webpack.config.*',
    'babel.config.*',
    'tsconfig.*.json',
    'turbo.json',
    'nx.json',
    'metro.config.*',
  ];
  const files = await listMatches(patterns, { cwd: root, limit: 50 });
  return files;
};

const summarize = async (root) => {
  const [
    pkg,
    tsconfig,
    codeConnect,
    componentRoots,
    themes,
    locks,
    env,
    config,
  ] = await Promise.all([
    summarizePackageJson(root),
    summarizeTsconfigs(root),
    summarizeCodeConnect(root),
    summarizeComponentRoots(root),
    summarizeThemes(root),
    summarizeLocks(root),
    summarizeEnv(root),
    summarizeConfigs(root),
  ]);

  const allFiles = await summarizeTsFiles(root, componentRoots, themes.recipes);
  const selectedFiles = allFiles;

  return {
    root,
    packageJson: pkg,
    tsconfig,
    codeConnect,
    components: { roots: componentRoots },
    themes,
    component_source_files: selectedFiles,
    component_source_files_meta: {
      total: allFiles.length,
      selectedCount: selectedFiles.length
    },
    locks,
    env,
    config,
  };
};

const main = async () => {
  const { root } = parseArgs(process.argv);
  const summary = await summarize(root);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}
