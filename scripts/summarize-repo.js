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

const fs = require('fs-extra');
const path = require('path');
const fg = require('fast-glob');
const { parse } = require('@typescript-eslint/typescript-estree');
const { detectFrameworks } = require('../src/util/detect-framework');
const { detectAngularComponents } = require('../src/util/scan-angular');

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
  let output = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--root' || arg === '-r') && args[i + 1]) {
      flagRoot = args[i + 1];
      i += 1;
    } else if (arg === '--output' && args[i + 1]) {
      output = args[i + 1];
      i += 1;
    } else if (!arg.startsWith('-') && positionalRoot === null) {
      positionalRoot = arg;
    }
  }
  const root = flagRoot || positionalRoot || process.cwd();
  return {
    root: path.resolve(root),
    output: output ? path.resolve(output) : path.join(path.resolve(root), 'superconnect', 'repo-summary.json'),
  };
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
  const ccPatterns = ['**/*.figma.tsx', '**/*.figma.ts'];
  const files = await listMatches(ccPatterns, { cwd: root, limit: 20 });
  return {
    config: configs,
    files: {
      count: await countFiles(ccPatterns, { cwd: root }),
      samples: files,
    },
  };
};

const summarizeComponentRoots = async (root) => {
  const rootPatterns = [
    'src/*/components',
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

const extractExports = (source, filePath = '') => {
  const names = new Set();
  
  try {
    const ast = parse(source, {
      loc: false,
      range: false,
      tokens: false,
      comment: false,
      jsx: true,
      sourceType: 'module',
      ecmaVersion: 'latest',
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false,
      // Allow parsing errors without throwing
      loggerFn: false
    });

    const traverse = (node) => {
      if (!node || typeof node !== 'object') return;

      // Handle export declarations
      if (node.type === 'ExportNamedDeclaration') {
        // export const X, export function X, export class X
        if (node.declaration) {
          if (node.declaration.type === 'VariableDeclaration') {
            node.declaration.declarations.forEach(decl => {
              if (decl.id && decl.id.name) names.add(decl.id.name);
            });
          } else if (node.declaration.id && node.declaration.id.name) {
            names.add(node.declaration.id.name);
          }
        }
        // export { X, Y as Z }
        if (node.specifiers) {
          node.specifiers.forEach(spec => {
            if (spec.exported && spec.exported.name) {
              names.add(spec.exported.name);
            }
          });
        }
      }

      // Handle default exports
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration && node.declaration.id && node.declaration.id.name) {
          names.add(node.declaration.id.name);
        } else {
          names.add('default');
        }
      }

      // Traverse children
      Object.keys(node).forEach(key => {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(traverse);
        } else if (child && typeof child === 'object') {
          traverse(child);
        }
      });
    };

    traverse(ast);
  } catch (err) {
    // Silently fall back to empty array on parse errors
    // This prevents the entire summarizer from crashing on syntax errors
    // The file will just report zero exports
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
    const exports = extractExports(content, relPath);
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

  const frameworkInfo = await detectFrameworks({ root, packageJson: pkg, ignore: DEFAULT_IGNORES });
  const allFiles = await summarizeTsFiles(root, componentRoots, themes.recipes);

  const selectedFiles = allFiles;
  const angularComponents = await detectAngularComponents({ root, ignore: DEFAULT_IGNORES });

  return {
    root,
    packageJson: pkg,
    tsconfig,
    codeConnect,
    components: { roots: componentRoots },
    themes,
    angular_components: angularComponents,
    component_source_files: selectedFiles,
    component_source_files_meta: {
      total: allFiles.length,
      selectedCount: selectedFiles.length
    },
    frameworks: frameworkInfo.frameworks,
    primary_framework: frameworkInfo.primaryFramework,
    locks,
    env,
    config,
  };
};

const main = async () => {
  const { root, output } = parseArgs(process.argv);
  const summary = await summarize(root);
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, serialized, 'utf8');
  }
  if (output) {
    console.log(`Repo summary written to ${output}`);
  } else {
    process.stdout.write(serialized);
  }
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`❌ Repository summarization failed: ${err.message}\n`);
    
    // Provide helpful context
    if (err.code === 'EACCES') {
      process.stderr.write('\n💡 Permission denied - check file/directory permissions\n');
    } else if (err.message.includes('glob') || err.message.includes('pattern')) {
      process.stderr.write('\n💡 File pattern error - check your file paths and patterns\n');
    } else if (err.message.includes('parse') || err.message.includes('JSON')) {
      process.stderr.write('\n💡 Parse error - check that your config files contain valid JSON/TOML\n');
    } else {
      process.stderr.write(`\nStack trace:\n${err.stack}\n`);
    }
    
    process.exitCode = 1;
  });
}

// Export for use in other scripts
module.exports = {
  summarizeComponentRoots,
  summarize
};
