#!/usr/bin/env -S node --experimental-strip-types
// @ts-nocheck

/**
 * run-pipeline.ts
 * 
 * Superconnect pipeline v4 (5 stages):
 * 1) Figma scan
 * 2) Repo summarizer
 * 3) Orienter
 * 4) Codegen
 * 5) Finalizer (summary)
 * 
 * Entry point for the superconnect CLI. Orchestrates all pipeline stages.
 */

import dotenv from 'dotenv';
// Load environment variables from .env file early (cwd)
dotenv.config({ quiet: true } as any);

import fs from 'fs-extra';
import path from 'path';
import { spawnSync, execSync } from 'child_process';
import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import toml from '@iarna/toml';
import { fileURLToPath } from 'url';
import { figmaColor, codeColor, generatedColor, highlight } from './colors.cjs';
import { scanPackage } from '../src/util/package-scan.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_FILE = 'superconnect.toml';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.2-codex';
const DEFAULT_API = 'anthropic-agent-sdk';
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_ORIENTATION_MAX_TOKENS = 32768;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_LAYER_DEPTH = 3;
const DEFAULT_CONCURRENCY = 5;

const parseMaybeInt = (value: any): number | null => {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function normalizeAgentApiName(value: any): string | null {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/^openai-chat-completions$/, 'openai-chat-api')
    .replace(/^openai$/, 'openai-chat-api')
    .replace(/^anthropic-agents$/, 'anthropic-agent-sdk')
    .replace(/^anthropic$/, 'anthropic-messages-api');
  return normalized;
}

function getAgentEnvVarForApi(api: string): string {
  return api === 'openai-chat-api' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

function loadSuperconnectConfig(filePath: string = 'superconnect.toml'): any {
  const direct = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(direct)) return null;
  try {
    const raw = fs.readFileSync(direct, 'utf8');
    return toml.parse(raw);
  } catch (err: any) {
    console.warn(`Warning: Failed to load ${direct}: ${err.message}`);
    if (err.message.includes('parse') || err.message.includes('Expected')) {
      console.warn('Hint: TOML syntax error - check your configuration file syntax');
      console.warn('   Valid TOML guide: https://toml.io/en/v1.0.0');
    }
    return null;
  }
}

function normalizeAgentConfig(agentSection: any = {}): any {
  const rawApi = normalizeAgentApiName(agentSection.api) || DEFAULT_API;
  if (agentSection.api && rawApi !== String(agentSection.api).trim().toLowerCase()) {
    console.warn(
      `${chalk.yellow('Warning: Deprecated agent api value:')} "${agentSection.api}"\n` +
        `   ${chalk.dim('Use one of: anthropic-agent-sdk, anthropic-messages-api, openai-chat-api')}`
    );
  }
  const api = ['openai-chat-api', 'anthropic-messages-api', 'anthropic-agent-sdk'].includes(rawApi)
    ? rawApi
    : DEFAULT_API;
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
      `${chalk.yellow('Warning: llm_proxy_url is set but api is "')}${api}${chalk.yellow('". llm_proxy_url is only used with api = "openai-chat-api".')}\n` +
      `   ${chalk.yellow('Did you mean to set api = "openai-chat-api"?')}`
    );
  }
  
  // Warn if using custom llm_proxy_url without explicitly setting model
  if (baseUrl && !agentSection.model) {
    console.warn(
      `${chalk.yellow('Warning: Using custom llm_proxy_url but no model specified.')}\n` +
      `   ${chalk.yellow(`Default model "${DEFAULT_OPENAI_MODEL}" may not exist on your endpoint.`)}\n` +
      `   ${chalk.dim('Add to superconnect.toml: model = "your-model-name"')}`
    );
  }
  
  return { api, model, maxTokens: resolvedMaxTokens, baseUrl, apiKey };
}

/**
 * Normalize [codegen] section from TOML config.
 */
function normalizeCodegenConfig(codegenSection: any = {}): any {
  const maxRetries = parseMaybeInt(codegenSection.max_retries) ?? DEFAULT_MAX_RETRIES;
  const concurrency = parseMaybeInt(codegenSection.concurrency) ?? DEFAULT_CONCURRENCY;
  const outputDir = codegenSection.code_connect_output_dir || null;
  const colocation = codegenSection.colocation !== undefined ? Boolean(codegenSection.colocation) : true;
  return { maxRetries, concurrency, outputDir, colocation };
}

/**
 * Normalize [figma] section from TOML config.
 */
function normalizeFigmaConfig(figmaSection: any = {}): any {
  const layerDepth = parseMaybeInt(figmaSection.layer_depth) ?? DEFAULT_LAYER_DEPTH;
  return { layerDepth };
}

/**
 * Resolve and validate package.json path, and derive import_from if not specified.
 * Returns { packagePath, importFrom } or throws descriptive error.
 */
function resolvePackageConfig(inputsSection: any = {}, basePath: string): { packagePath: string; importFrom: string | null } {
  const rawPackage = inputsSection.package || './package.json';
  const packagePath = path.resolve(basePath, rawPackage);
  
  // Validate package.json exists
  if (!fs.existsSync(packagePath)) {
    throw new Error(
      `Package file not found: ${packagePath}\n` +
      `   Check your [inputs].package setting in superconnect.toml\n` +
      `   Expected path: ${rawPackage}`
    );
  }
  
  // Validate it's a file (not a directory)
  const stat = fs.statSync(packagePath);
  if (!stat.isFile()) {
    throw new Error(
      `Package path is not a file: ${packagePath}\n` +
      `   The package setting should point to a package.json file`
    );
  }
  
  // Try to read and parse the package.json
  let pkgJson: any;
  try {
    const content = fs.readFileSync(packagePath, 'utf8');
    pkgJson = JSON.parse(content);
  } catch (err: any) {
    throw new Error(
      `Failed to parse package.json at ${packagePath}\n` +
      `   ${err.message}`
    );
  }
  
  // Derive import_from from package.json name if not explicitly set
  const explicitImportFrom = inputsSection.import_from || null;
  if (explicitImportFrom) {
    return { packagePath, importFrom: explicitImportFrom };
  }
  
  // Auto-derive from package.json name
  const pkgName = pkgJson.name;
  if (!pkgName) {
    throw new Error(
      `Cannot derive import_from: package.json has no "name" field\n` +
      `   Package: ${packagePath}\n` +
      `   Either:\n` +
      `     - Add "name" field to package.json, OR\n` +
      `     - Set import_from explicitly in superconnect.toml [inputs] section`
    );
  }
  
  return { packagePath, importFrom: pkgName };
}

async function promptConfirmProceed({ message, defaultYes = true }: { message: string; defaultYes?: boolean }): Promise<boolean | null> {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const raw = await question(message + suffix);
  rl.close();
  if (!raw) return defaultYes;
  const normalized = raw.toLowerCase();
  if (['y', 'yes'].includes(normalized)) return true;
  if (['n', 'no'].includes(normalized)) return false;
  return defaultYes;
}

/**
 * Discover all package.json files in a directory, excluding node_modules.
 * Returns array of { path: relative path, name: package name, absPath: absolute path }
 */
function discoverPackageJsonFiles(basePath: string): Array<{ path: string; name: string; absPath: string }> {
  const packages: Array<{ path: string; name: string; absPath: string }> = [];
  const visited = new Set<string>();
  
  function scan(dir: string) {
    const absDir = path.resolve(basePath, dir);
    
    // Avoid infinite loops and revisiting
    if (visited.has(absDir)) return;
    visited.add(absDir);
    
    // Skip node_modules, .git, and other common ignored directories
    const dirName = path.basename(absDir);
    if (dirName === 'node_modules' || dirName === '.git' || dirName === 'dist' || dirName === 'build') {
      return;
    }
    
    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      
      // Check for package.json in current directory
      const packageJsonPath = path.join(absDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = fs.readJsonSync(packageJsonPath);
          const relativePath = path.relative(basePath, packageJsonPath);
          packages.push({
            path: relativePath,
            name: pkg.name || '(unnamed)',
            absPath: packageJsonPath
          });
        } catch {
          // Ignore invalid package.json files
        }
      }
      
      // Recursively scan subdirectories (limit depth to avoid deep traversal)
      // Calculate depth relative to basePath
      const relativeDepth = path.relative(basePath, absDir).split(path.sep).filter(Boolean).length;
      if (relativeDepth < 4) {  // Max 4 levels deep from root
        for (const entry of entries) {
          if (entry.isDirectory()) {
            scan(path.join(dir, entry.name));
          }
        }
      }
    } catch {
      // Ignore directories we can't read
    }
  }
  
  scan('.');
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

async function promptForConfig(): Promise<{ config: any; api: string; hasCustomBaseUrl: boolean }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));

  console.log(
    `${chalk.bold('Setup')}: we'll write these settings to ${highlight(`./${DEFAULT_CONFIG_FILE}`)}`
  );
  console.log(chalk.dim('Press Enter to accept [default values]\n'));
  // Helper function to validate Figma URL
  const isValidFigmaUrl = (input: string): boolean => {
    // Accept full Figma URLs or just file keys
    if (input.includes('figma.com')) {
      // Check if it's a valid Figma design URL
      return /figma\.com\/(design|file)\/[a-zA-Z0-9_-]+/.test(input);
    }
    // Accept bare file keys (alphanumeric strings, can include hyphens/underscores)
    return /^[a-zA-Z0-9_-]+$/.test(input) && input.length > 5;
  };

  const figmaUrl = await (async () => {
    while (true) {
      const value = await question(`${chalk.cyan('Figma file URL (paste the URL of your design system file)')}: `);
      if (!value) {
        console.log(chalk.red('Figma URL is required.'));
        continue;
      }
      if (!isValidFigmaUrl(value)) {
        console.log(chalk.red('That doesn\'t look like a Figma URL. Expected format: https://www.figma.com/design/ABC123/... or just the file key (ABC123)'));
        continue;
      }
      return value;
    }
  })();

  // Package selection and import pattern configuration
  // Discover packages from current directory (where user ran the command)
  console.log(`\n${chalk.bold('Package Configuration')}`);
  console.log(chalk.dim('Discovering package.json files...'));
  
  const discoveredPackages = discoverPackageJsonFiles(process.cwd());
  
  let selectedPackagePath: string;
  let selectedPackageName: string | null = null;
  let importFrom: string | null = null;
  
  if (discoveredPackages.length === 0) {
    console.log(chalk.yellow('No package.json found. You can add one later.'));
    selectedPackagePath = 'package.json'; // Default
  } else if (discoveredPackages.length === 1) {
    // Single package - auto-select
    const pkg = discoveredPackages[0];
    selectedPackagePath = pkg.path;
    selectedPackageName = pkg.name === '(unnamed)' ? null : pkg.name;
    
    console.log(`${chalk.green('✓')} Found package: ${chalk.bold(pkg.name)} ${chalk.dim(`(${pkg.path})`)}`);
  } else {
    // Multiple packages - prompt user to select
    console.log(`\nFound ${discoveredPackages.length} packages:\n`);
    discoveredPackages.forEach((pkg, index) => {
      console.log(`  ${index + 1}. ${pkg.path} ${chalk.dim(`(${pkg.name})`)}`);
    });
    console.log();
    
    const selection = await (async () => {
      while (true) {
        const input = await question(
          `${chalk.cyan('Which contains your design system components?')} (1-${discoveredPackages.length}): `
        );
        const num = parseInt(input, 10);
        if (num >= 1 && num <= discoveredPackages.length) {
          return num - 1;
        }
        console.log(chalk.red(`Please enter a number between 1 and ${discoveredPackages.length}`));
      }
    })();
    
    const selected = discoveredPackages[selection];
    selectedPackagePath = selected.path;
    selectedPackageName = selected.name === '(unnamed)' ? null : selected.name;
    console.log(`${chalk.green('✓')} Selected: ${chalk.bold(selected.name)} ${chalk.dim(`(${selected.path})`)}\n`);
  }
  
  // Show import pattern and allow override
  if (selectedPackageName && selectedPackageName !== '(unnamed)') {
    console.log(`Import pattern: ${chalk.cyan(`import { X } from "${selectedPackageName}"`)}`);
    
    const confirmImport = await (async () => {
      const input = await question(
        `${chalk.cyan('Is this correct?')} [${chalk.dim('Y/n/edit')}]: `
      );
      const normalized = input.toLowerCase().trim();
      if (!normalized || normalized === 'y' || normalized === 'yes') {
        return 'yes';
      } else if (normalized === 'edit' || normalized === 'e') {
        return 'edit';
      } else {
        return 'no';
      }
    })();
    
    if (confirmImport === 'edit') {
      const customImport = await question(
        `${chalk.cyan('Enter import pattern')} (e.g., @/components): `
      );
      if (customImport.trim()) {
        importFrom = customImport.trim();
        console.log(`${chalk.green('✓')} Using custom import: ${chalk.cyan(`import { X } from "${importFrom}"`)}`);
      }
    } else if (confirmImport === 'no') {
      console.log(chalk.yellow('You can edit the import_from field in superconnect.toml later.'));
    }
  }

  console.log(`\n${chalk.bold('Agent API Configuration')}`);
  console.log(`${chalk.dim('Choose which AI service to use for code generation')}`);
  
  const apiInput = await question(
    `${chalk.cyan('AI provider')} (${chalk.dim('anthropic-agent-sdk')}, anthropic-messages-api, openai-chat-api) [${chalk.dim('anthropic-agent-sdk')}]: `
  );
  const api = normalizeAgentApiName(apiInput) || 'anthropic-agent-sdk';
  const normalizedApi = ['openai-chat-api', 'anthropic-messages-api', 'anthropic-agent-sdk'].includes(api)
    ? api
    : 'anthropic-agent-sdk';

  let baseUrl: string | null = null;
  let apiKey: string | null = null;
  
  if (normalizedApi === 'openai-chat-api') {
    console.log(`\n${chalk.dim('OpenAI-compatible endpoints: LiteLLM, Azure OpenAI, vLLM, LocalAI, etc.')}`);
    const baseUrlInput = await question(
      `${chalk.cyan('Custom base URL (optional, press Enter to use api.openai.com)')}: `
    );
    if (baseUrlInput) {
      baseUrl = baseUrlInput;
      console.log(`${chalk.dim('Using custom endpoint:')} ${baseUrl}`);
      
      const apiKeyInput = await question(
        `${chalk.cyan('Custom API key (optional, press Enter to use OPENAI_API_KEY env var)')}: `
      );
      if (apiKeyInput) {
        apiKey = apiKeyInput;
      }
    }
  }

  rl.close();

  const active = normalizedApi;
  const chooseModel = (a: string): string => {
    if (a === 'openai-chat-api') return DEFAULT_OPENAI_MODEL;
    return DEFAULT_ANTHROPIC_MODEL;
  };
  const model = chooseModel(active);
  const maxTokens = DEFAULT_MAX_TOKENS;

  const agentSection: string[] = [];
  
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
    const lines: string[] = [
      '# AI provider: "anthropic-agent-sdk" (default) or "openai-chat-api"',
      '# Anthropic requires ANTHROPIC_API_KEY env var',
      '# OpenAI requires OPENAI_API_KEY env var (or use llm_proxy_url for LiteLLM, Azure, etc.)',
      'api = "openai-chat-api"',
      `model = "${model}"`
    ];
    if (baseUrl) {
      lines.push(`llm_proxy_url = "${baseUrl}"`);
    }
    if (apiKey) {
      lines.push(`api_key = "${apiKey}"`);
    }
    lines.push(
      '',
      '# To use Anthropic instead, comment out the above and uncomment:',
      '# api = "anthropic-agent-sdk"',
      `# model = "${DEFAULT_ANTHROPIC_MODEL}"`
    );
    agentSection.push(...lines);
  }

  // Build inputs section with conditional package/import_from fields
  const inputsSection = [
    '[inputs]',
    '# Your Figma design file URL',
    `figma_file_url = "${figmaUrl}"`,
    ''
  ];
  
  // Only write package field if it's NOT the root package.json
  if (selectedPackagePath && selectedPackagePath !== 'package.json' && selectedPackagePath !== './package.json') {
    inputsSection.push(
      '# Which package.json contains your design system components',
      `package = "${selectedPackagePath}"`,
      ''
    );
  } else {
    inputsSection.push(
      '# Which package.json contains your design system components (default: "./package.json")',
      '# For monorepos, point to the specific package:',
      '# package = "packages/ui/package.json"',
      ''
    );
  }
  
  // Only write import_from if user explicitly overrode the default
  if (importFrom) {
    inputsSection.push(
      '# How consumers import components from your package',
      `import_from = "${importFrom}"`,
      ''
    );
  } else {
    inputsSection.push(
      '# How consumers import components from your package (default: auto-detected from package.json "name")',
      '# Override only if consumers use a path alias or inline imports:',
      '# import_from = "@/components"  # for path aliases',
      '# import_from = "./src/components"  # for inline imports',
      ''
    );
  }
  
  inputsSection.push(
    '# Environment variables required:',
    '#   FIGMA_ACCESS_TOKEN - Figma personal access token',
    '#   ANTHROPIC_API_KEY or OPENAI_API_KEY - AI provider key',
    ''
  );
  
  const tomlContent = [
    '# Superconnect configuration',
    '# Docs: https://github.com/bitovi/superconnect#readme',
    '',
    ...inputsSection,
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
  
  // Return config info for post-config summary
  return {
    config: toml.parse(tomlContent),
    api: normalizedApi,
    hasCustomBaseUrl: Boolean(baseUrl)
  };
}

/**
 * Run a Node.js script directly without spawning a shell.
 * This avoids Windows PowerShell issues where cmd.exe as an intermediary
 * can interfere with console output and ANSI color codes.
 */
function runNodeScript(label: string, scriptPath: string, args: string[] = [], options: any = {}): void {
  console.log(`${chalk.dim('*')} ${label}`);
  const { env: extraEnv, allowInterrupt = false, ...rest } = options || {};
  const mergedEnv = { ...process.env, ...(extraEnv || {}) };
  const shouldCapture = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPERCONNECT_E2E_VERBOSE || '').toLowerCase());
  
  // Call Node.js directly without shell - more reliable cross-platform
  const result = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...args], {
    stdio: shouldCapture ? 'pipe' : 'inherit',
    env: mergedEnv,
    ...rest
  });
  
  if (result.signal === 'SIGINT' && allowInterrupt) {
    console.warn(`Warning: ${label} interrupted by SIGINT; continuing to finalize...`);
    return;
  }
  if (result.status !== 0) {
    const status = result.status || 1;
    if (shouldCapture) {
      const stdout = result.stdout ? result.stdout.toString().trim() : '';
      const stderr = result.stderr ? result.stderr.toString().trim() : '';
      console.error(`Error: ${label} failed with code ${status}`);
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
        console.error(`spawn error: ${(result.error as any).stack || (result.error as any).message || result.error}`);
      }
    } else {
      console.error(`Error: ${label} failed with code ${status}`);
    }
    process.exit(status);
  }
}

/**
 * Get version string with git SHA if available
 */
function getVersionString(): string {
  const pkg = fs.readJsonSync(path.join(__dirname, '..', 'package.json'));
  const semver = pkg.version;
  
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
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return `${semver} (${sha})`;
  } catch {
    return semver;
  }
}

function parseList(values: any): string[] {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  return raw
    .flatMap((item: any) => String(item).split(','))
    .map((s: string) => s.trim())
    .filter(Boolean);
}

function loadEnvToken(): string | null {
  return process.env.FIGMA_ACCESS_TOKEN || null;
}

function loadAgentToken(api: string): string | null {
  const envVar = getAgentEnvVarForApi(api);
  return process.env[envVar] || null;
}

function tryReadEnvFile(envPath: string): { exists: boolean; parsed: any } {
  try {
    if (!fs.existsSync(envPath)) return { exists: false, parsed: null };
    const raw = fs.readFileSync(envPath, 'utf8');
    return { exists: true, parsed: dotenv.parse(raw) };
  } catch {
    return { exists: false, parsed: null };
  }
}

function loadDotenvFromTargetRepo(targetRepoPath: string): { envPath: string; loaded: boolean; exists: boolean; parsed: any } {
  const envPath = path.join(targetRepoPath, '.env');
  const { exists, parsed } = tryReadEnvFile(envPath);
  try {
    const result = dotenv.config({ path: envPath, override: false, quiet: true } as any);
    return { envPath, loaded: !result.error, exists, parsed };
  } catch {
    return { envPath, loaded: false, exists, parsed };
  }
}

function resolveEnvVarSource({ key, cliFlagUsed, parsedTargetEnv }: { key: string; cliFlagUsed: boolean; parsedTargetEnv: any }): { valuePresent: boolean; note: string } {
  if (cliFlagUsed) return { valuePresent: true, note: 'from command flag' };
  const valuePresent = Boolean(process.env[key]);
  if (!valuePresent) return { valuePresent: false, note: 'not set' };
  if (parsedTargetEnv && Object.prototype.hasOwnProperty.call(parsedTargetEnv, key)) {
    return { valuePresent, note: 'from target repo .env' };
  }
  return { valuePresent, note: 'from your environment' };
}

function formatEnvStatusLine({ key, valuePresent, note }: { key: string; valuePresent: boolean; note: string }): string {
  const mark = valuePresent ? chalk.green('OK') : chalk.dim('-');
  const suffix = note ? chalk.dim(` (${note})`) : '';
  return `  ${mark} ${key}${suffix}`;
}

function showKeyStatus({
  version,
  targetRepoPath,
  envPath,
  envPathLoaded,
  parsedTargetEnv,
  figmaTokenFromFlag,
  hasAnthropicKey,
  hasOpenAIKey,
  selectedAgentApi,
  selectionReason
}: any): void {
  console.log(`\nSuperconnect v${version}`);
  console.log(`Target repo: ${targetRepoPath}`);

  console.log(chalk.dim('Environment variables found:'));
  const figma = resolveEnvVarSource({
    key: 'FIGMA_ACCESS_TOKEN',
    cliFlagUsed: Boolean(figmaTokenFromFlag),
    parsedTargetEnv
  });
  console.log(formatEnvStatusLine({ key: 'FIGMA_ACCESS_TOKEN', valuePresent: figma.valuePresent, note: figma.note }));

  const anthropic = resolveEnvVarSource({
    key: 'ANTHROPIC_API_KEY',
    cliFlagUsed: false,
    parsedTargetEnv
  });
  console.log(formatEnvStatusLine({ key: 'ANTHROPIC_API_KEY', valuePresent: hasAnthropicKey, note: anthropic.note }));

  const openai = resolveEnvVarSource({
    key: 'OPENAI_API_KEY',
    cliFlagUsed: false,
    parsedTargetEnv
  });
  console.log(formatEnvStatusLine({ key: 'OPENAI_API_KEY', valuePresent: hasOpenAIKey, note: openai.note }));

  if (selectedAgentApi) {
    console.log(
      `${chalk.dim('*')} ${highlight('Agent provider')}: ${highlight(selectedAgentApi)}${
        selectionReason ? chalk.dim(` (${selectionReason})`) : ''
      }`
    );
  }
}

function autoSelectProvider({ configuredApi, hasAnthropicKey, hasOpenAIKey, defaultWhenBoth = true }: any): { api: string | null; reason: string | null } {
  const normalizedConfigured = normalizeAgentApiName(configuredApi);
  const isOnlyAnthropic = hasAnthropicKey && !hasOpenAIKey;
  const isOnlyOpenAI = hasOpenAIKey && !hasAnthropicKey;
  const isBoth = hasAnthropicKey && hasOpenAIKey;

  if (isOnlyAnthropic) return { api: 'anthropic-agent-sdk', reason: 'auto-selected: only ANTHROPIC_API_KEY present' };
  if (isOnlyOpenAI) return { api: 'openai-chat-api', reason: 'auto-selected: only OPENAI_API_KEY present' };
  if (isBoth) {
    if (normalizedConfigured && ['openai-chat-api', 'anthropic-messages-api', 'anthropic-agent-sdk'].includes(normalizedConfigured)) {
      return { api: normalizedConfigured, reason: 'config: [agent].api' };
    }
    if (!defaultWhenBoth) {
      return { api: null, reason: 'multiple keys present; you will be prompted' };
    }
    return { api: DEFAULT_API, reason: 'default: both keys present; set [agent].api to override' };
  }
  return { api: normalizedConfigured || DEFAULT_API, reason: null };
}

function resolvePaths(config: any): any {
  const target = config.target;
  const scriptDir = __dirname;
  const superconnectDir = path.join(target, 'superconnect-logs');
  const figmaDir = path.join(superconnectDir, 'figma-components');
  const figmaIndex = path.join(superconnectDir, 'figma-components-index.json');
  const packageScan = path.join(superconnectDir, 'package-scan.json');
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
    packageScan,
    orientation,
    agentLogDir,
    codegenTranscriptDir,
    codeConnectDir,
    summaryFile
  };
}

async function runInitCommand(): Promise<void> {
  // Welcome message
  console.log('Superconnect generates Figma Code Connect mappings using AI.\n');
  console.log('This wizard creates superconnect.toml, which stores:');
  console.log('  • Your Figma design file URL');
  console.log('  • Your component library location');
  console.log('  • AI provider settings\n');
  console.log('After setup, you can review the config and then run `superconnect` to generate.\n');

  // Environment check
  const figmaToken = loadEnvToken();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log(chalk.dim('Environment check:'));
  console.log(figmaToken 
    ? `  ${chalk.green('✓')} FIGMA_ACCESS_TOKEN ${chalk.dim('(found in environment)')}` 
    : `  ${chalk.dim('-')} FIGMA_ACCESS_TOKEN ${chalk.dim('(not set)')}`);
  console.log(anthropicKey 
    ? `  ${chalk.green('✓')} ANTHROPIC_API_KEY ${chalk.dim('(found in environment)')}` 
    : `  ${chalk.dim('-')} ANTHROPIC_API_KEY ${chalk.dim('(not set)')}`);
  console.log(openaiKey 
    ? `  ${chalk.green('✓')} OPENAI_API_KEY ${chalk.dim('(found in environment)')}` 
    : `  ${chalk.dim('-')} OPENAI_API_KEY ${chalk.dim('(not set)')}`);
  console.log();
  console.log(chalk.dim('Missing keys? See: https://github.com/bitovi/superconnect#required-environment-and-config'));
  console.log();

  const existing = fs.existsSync(path.resolve(DEFAULT_CONFIG_FILE));
  if (existing) {
    console.log(`${chalk.green('OK')} ${highlight(`./${DEFAULT_CONFIG_FILE}`)} already exists`);
  }
  
  const { config, api, hasCustomBaseUrl } = await promptForConfig();
  
  // Post-config summary
  console.log(`\n${chalk.green('✓')} Created superconnect.toml\n`);
  
  // Re-check environment variables
  const figmaTokenAfter = loadEnvToken();
  const anthropicKeyAfter = process.env.ANTHROPIC_API_KEY;
  const openaiKeyAfter = process.env.OPENAI_API_KEY;
  
  console.log('Before running generation, ensure you have:');
  
  // Determine which key is required based on chosen API
  const needsAnthropic = api === 'anthropic-agent-sdk' || api === 'anthropic-messages-api';
  const needsOpenAI = api === 'openai-chat-api';
  
  // Always show FIGMA_ACCESS_TOKEN
  if (figmaTokenAfter) {
    console.log(`  ${chalk.green('✓')} FIGMA_ACCESS_TOKEN      ${chalk.dim('(found in environment)')}`);
  } else {
    console.log(`  ${chalk.dim('-')} FIGMA_ACCESS_TOKEN      ${chalk.dim('(not set - required for Figma API)')}`);
  }
  
  // Show relevant API key based on chosen provider
  if (needsAnthropic) {
    if (anthropicKeyAfter) {
      console.log(`  ${chalk.green('✓')} ANTHROPIC_API_KEY       ${chalk.dim('(found in environment)')}`);
    } else {
      console.log(`  ${chalk.dim('-')} ANTHROPIC_API_KEY       ${chalk.dim('(not set - required for Anthropic APIs)')}`);
    }
  } else if (needsOpenAI) {
    if (openaiKeyAfter) {
      console.log(`  ${chalk.green('✓')} OPENAI_API_KEY          ${chalk.dim('(found in environment)')}`);
    } else {
      console.log(`  ${chalk.dim('-')} OPENAI_API_KEY          ${chalk.dim('(not set - required for OpenAI API)')}`);
    }
  }
  
  console.log();
  
  // Custom LLM endpoint warning
  if (hasCustomBaseUrl) {
    console.log(`${chalk.yellow('⚠')}  You configured a custom LLM endpoint. Verify llm_proxy_url in superconnect.toml.\n`);
  }
  
  // Customization options
  console.log('You can customize superconnect.toml to adjust:');
  console.log('  • concurrency    - parallel processing, lower if hitting rate limits (default: 5)');
  console.log('  • colocation     - put .figma.tsx next to components vs centralized (default: true)');
  console.log('  • max_retries    - retry attempts for validation errors (default: 4)');
  console.log();
  
  const hasMissingKeys = !figmaTokenAfter || (needsAnthropic && !anthropicKeyAfter) || (needsOpenAI && !openaiKeyAfter);
  
  const runNow = await promptConfirmProceed({ message: 'Ready to generate Code Connect files?', defaultYes: false });
  if (runNow === true) {
    const result = spawnSync(process.execPath, [__filename], { stdio: 'inherit', env: process.env });
    process.exit(result.status ?? 1);
  }
  
  // Next steps
  console.log();
  console.log(chalk.dim('Next steps:'));
  if (hasMissingKeys) {
    console.log('  1. Set missing environment variables (see above)');
    console.log(`  2. Optionally edit ${highlight('superconnect.toml')}`);
    console.log(`  3. Run ${highlight('superconnect')} to generate files`);
  } else {
    console.log(`  1. Optionally edit ${highlight('superconnect.toml')}`);
    console.log(`  2. Run ${highlight('superconnect')} to generate files`);
  }
}

async function runPipelineCommand(args: any): Promise<void> {
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\n${chalk.yellow('Received SIGINT. Attempting graceful stop after current stage...')}`);
  });

  const prospectiveTarget = args.target ? path.resolve(args.target) : path.resolve('.');

  const cfg = loadSuperconnectConfig(DEFAULT_CONFIG_FILE);
  if (!cfg) {
    console.log(`Superconnect v${getVersionString()}\n`);
    console.log('No configuration found. Run this first:\n');
    console.log(`  ${highlight('superconnect init')}\n`);
    console.log('This creates superconnect.toml with your Figma file URL and settings.');
    process.exit(1);
  }
  console.log(`${chalk.green('✓')} Using ${highlight('superconnect.toml')} in ${process.cwd()}`);
  console.log(`  ${chalk.dim('Tip: Run "superconnect init" again to change settings')}\n`);
  const figmaUrl = args.figmaUrl || cfg.inputs?.figma_file_url || undefined;
  
  // Target is always current working directory (where superconnect.toml lives)
  const target = args.target || path.resolve('.');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`Error: Target repo not found or not a directory: ${target}`);
    process.exit(1);
  }

  // Load .env from target repo (useful when running from outside the target)
  const targetEnv = loadDotenvFromTargetRepo(target);

  const figmaToken = args.figmaToken || loadEnvToken();

  const detectedAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const detectedOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const provider = autoSelectProvider({
    configuredApi: cfg.agent?.api,
    hasAnthropicKey: detectedAnthropicKey,
    hasOpenAIKey: detectedOpenAIKey
  });

  const agentConfig = normalizeAgentConfig({ ...(cfg.agent || {}), api: provider.api });
  const codegenConfig = normalizeCodegenConfig(cfg.codegen || {});
  const figmaConfig = normalizeFigmaConfig(cfg.figma || {});
  
  // Resolve and validate package.json path, derive import_from
  let packageConfig: { packagePath: string; importFrom: string | null };
  try {
    packageConfig = resolvePackageConfig(cfg.inputs || {}, target);
  } catch (err: any) {
    console.error(`${chalk.red('Error:')} ${err.message}`);
    process.exit(1);
  }
  
  const agentEnvVar = getAgentEnvVarForApi(agentConfig.api);
  const agentToken = agentConfig.apiKey || loadAgentToken(agentConfig.api);

  showKeyStatus({
    version: getVersionString(),
    targetRepoPath: target,
    envPath: targetEnv.envPath,
    envPathLoaded: targetEnv.loaded,
    parsedTargetEnv: targetEnv.parsed,
    figmaTokenFromFlag: Boolean(args.figmaToken),
    hasAnthropicKey: detectedAnthropicKey,
    hasOpenAIKey: detectedOpenAIKey,
    selectedAgentApi: agentConfig.api,
    selectionReason: provider.reason
  });

  const paths = resolvePaths({ ...args, figmaUrl, target, figmaToken, outputDir: codegenConfig.outputDir, colocation: codegenConfig.colocation });

  fs.ensureDirSync(paths.superconnectDir);
  fs.ensureDirSync(paths.figmaDir);

  const prospectiveFigmaIndex = path.join(target, 'superconnect-logs', 'figma-components-index.json');
  const figmaIndexMissing = !fs.existsSync(prospectiveFigmaIndex);

  if (figmaIndexMissing && !args.figmaToken && !loadEnvToken()) {
    console.error('Error: FIGMA_ACCESS_TOKEN is required to run the Figma scan.');
    console.error('   Set FIGMA_ACCESS_TOKEN in your environment or target repo .env, or pass --figma-token.');
    console.error('   Figma tokens: https://www.figma.com/developers/api#access-tokens');
    process.exit(1);
  }

  const needFigmaScan = args.force || !fs.existsSync(paths.figmaIndex);
  const needPackageScan = args.force || !fs.existsSync(paths.packageScan);
  const needOrientation = args.force || !fs.existsSync(paths.orientation);
  const rel = (p: string): string => path.relative(process.cwd(), p) || p;

  const needsAgent = !args.dryRun;
  if (needsAgent) {
    console.log(`${chalk.dim('Plan:')}`);
    console.log(`  Target: ${highlight(target)}`);
    console.log(`  Figma: ${paths.figmaUrl ? highlight(paths.figmaUrl) : chalk.dim('(from config)')}`);
    console.log(`  Output: ${codegenConfig.colocation ? highlight('colocated next to components') : highlight(rel(paths.codeConnectDir))}`);
    if (args.only?.length) console.log(`  Only: ${highlight(args.only.join(', '))}`);
    if (args.exclude?.length) console.log(`  Exclude: ${highlight(args.exclude.join(', '))}`);
    console.log(`  Stages: package ${needPackageScan ? highlight('scan') : chalk.dim('skip')}, figma ${needFigmaScan ? highlight('scan') : chalk.dim('skip')}, orienter ${needOrientation ? highlight('run') : chalk.dim('skip')}, codegen ${highlight('run')}`);

    if (!args.yes) {
      const confirmed = await promptConfirmProceed({ message: 'Proceed with generation?', defaultYes: true });
      if (confirmed === null) {
        console.error('Error: Non-interactive terminal detected.');
        console.error(`   Re-run with ${highlight('--yes')} to proceed without confirmation.`);
        process.exit(1);
      }
      if (!confirmed) {
        console.log(chalk.dim('Canceled.'));
        process.exit(0);
      }
    }
  }
  if (needsAgent && !agentToken) {
    console.error(`Error: ${agentEnvVar} is required to run agent-backed stages (${agentConfig.api}).`);
    console.error(`   Set ${agentEnvVar} in your environment or target repo .env, or set [agent].api_key in superconnect.toml.`);
    console.error(`   Anthropic keys: https://console.anthropic.com/`);
    console.error(`   OpenAI keys: https://platform.openai.com/api-keys`);
    console.error(`   Or run with --dry-run to skip agent stages`);
    process.exit(1);
  }

  if (needPackageScan) {
    console.log(
      `${highlight('Package scan')} -> ${codeColor(rel(paths.packageScan))}`
    );
    const scanResult = await scanPackage(packageConfig.packagePath);
    await fs.writeJson(paths.packageScan, scanResult, { spaces: 2 });
  } else {
    console.log(
      `${chalk.dim('*')} ${highlight('Package scan')} (skipped, ${codeColor(
        rel(paths.packageScan)
      )} present)`
    );
  }
  let inferredFramework = args.framework || null;
  try {
    const scanData = fs.readJsonSync(paths.packageScan);
    if (!inferredFramework && scanData?.primary_framework) {
      inferredFramework = scanData.primary_framework;
    }
  } catch {
    // ignore; will remain null
  }

  if (needFigmaScan && !figmaToken) {
    console.error('Error: FIGMA_ACCESS_TOKEN is required to run the Figma scan.');
    console.error('   Set FIGMA_ACCESS_TOKEN in your environment or .env, or pass --figma-token.');
    process.exit(1);
  }

  if (needFigmaScan) {
    if (!paths.figmaUrl) {
      console.error('Error: --figma-url is required for figma scan when no index exists.');
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
      `${highlight('Figma scan')} -> ${figmaColor(rel(paths.figmaIndex))}`,
      path.join(paths.scriptDir, 'figma-scan.ts'),
      figmaScanArgs
    );
  } else {
    console.log(
      `${chalk.dim('*')} ${highlight('Figma scan')} (skipped, ${figmaColor(
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
      '--package-scan', paths.packageScan,
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
      `${highlight('Repo orientation')} -> ${generatedColor(rel(paths.orientation))}`,
      path.join(paths.scriptDir, 'run-orienter.ts'),
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
      `${chalk.dim('*')} ${highlight('Repo orientation')} (skipped, ${generatedColor(
        rel(paths.orientation)
      )} already present)`
    );
  }

  if (!args.dryRun) {
    const codegenArgs = [
      '--figma-index', paths.figmaIndex,
      '--orienter', paths.orientation,
      '--package-scan', paths.packageScan,
      '--agent-api', agentConfig.api,
      ...(agentConfig.model ? ['--agent-model', agentConfig.model] : []),
      ...(agentConfig.maxTokens ? ['--agent-max-tokens', String(agentConfig.maxTokens)] : []),
      ...(agentConfig.baseUrl ? ['--agent-base-url', agentConfig.baseUrl] : []),
      ...(agentConfig.apiKey ? ['--agent-api-key', agentConfig.apiKey] : []),
      '--concurrency', String(codegenConfig.concurrency),
      ...(codegenConfig.colocation !== undefined ? ['--colocation', String(codegenConfig.colocation)] : []),
      ...(args.only && args.only.length ? ['--only', args.only.join(',')] : []),
      ...(args.exclude && args.exclude.length ? ['--exclude', args.exclude.join(',')] : []),
      ...(inferredFramework ? ['--target-framework', inferredFramework] : []),
      ...(packageConfig.importFrom ? ['--import-from', packageConfig.importFrom] : []),
      ...(args.force ? ['--force'] : [])
    ];
    runNodeScript(
      `${highlight('Code generation')} (${codeColor(rel(paths.orientation))} -> ${generatedColor(rel(paths.codeConnectDir))})`,
      path.join(paths.scriptDir, 'run-codegen.ts'),
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
    console.log(`${chalk.dim('*')} ${highlight('Code generation')} skipped (dry run)`);
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
      path.join(paths.scriptDir, 'finalize.ts'),
      finalizeArgs,
      {
        env: {
          FIGMA_ACCESS_TOKEN: figmaToken || process.env.FIGMA_ACCESS_TOKEN,
          [agentEnvVar]: agentToken || process.env[agentEnvVar]
        }
      }
    );
  }

  console.log(`${chalk.green('OK')} Pipeline complete.`);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('superconnect')
    .version(getVersionString())
    .usage('[options]')
    .option('--figma-url <value>', 'Figma file URL or key (needed for figma scan when not cached)')
    .option('--figma-token <token>', 'Figma API token (or FIGMA_ACCESS_TOKEN/.env)')
    .option('--target <path>', 'Target repo to write Code Connect into')
    .option('--framework <name>', 'Target framework override (react|angular)')
    .option('--force', 'Re-run stages even if outputs exist')
    .option('--dry-run', 'Skip agent-powered stages; still run summary', false)
    .option('--yes', 'Skip confirmation prompts', false)
    .option('--only <list...>', 'Component names/IDs (globs allowed) to include; accepts comma or space separated values')
    .option('--exclude <list...>', 'Component names/IDs (globs allowed) to skip');

  program
    .command('init')
    .description(`Create ./${DEFAULT_CONFIG_FILE} via interactive setup`)
    .action(async () => {
      await runInitCommand();
    });

  program.action(async () => {
    const opts = program.opts();
    const args = {
      figmaUrl: opts.figmaUrl || undefined,
      figmaToken: opts.figmaToken,
      target: opts.target ? path.resolve(opts.target) : undefined,
      force: Boolean(opts.force),
      framework: opts.framework || undefined,
      dryRun: Boolean(opts.dryRun),
      yes: Boolean(opts.yes),
      only: parseList(opts.only),
      exclude: parseList(opts.exclude)
    };
    await runPipelineCommand(args);
  });

  await program.parseAsync(process.argv);
}

// ESM equivalent of require.main === module
const isMain = import.meta.url === `file://${process.argv[1]}` || 
               import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  main().catch((err: any) => {
    console.error(`\nError: Pipeline failed: ${err.message}`);
    
    // Provide helpful context based on error type
    if (err.code === 'ENOENT') {
      console.error('\nHint: File not found - check that all required files exist');
      console.error('   Common causes:');
      console.error('   - Missing superconnect.toml configuration file');
      console.error('   - Missing Figma scan output files');
      console.error('   - Incorrect file paths in configuration');
    } else if (err.code === 'EACCES') {
      console.error('\nHint: Permission denied - check file/directory permissions');
    } else if (err.message.includes('FIGMA') || err.message.includes('Figma')) {
      console.error('\nHint: Figma-related error - check your FIGMA_ACCESS_TOKEN and network connection');
    } else if (err.message.includes('API') || err.message.includes('fetch')) {
      console.error('\nHint: API error - check your API keys and network connection');
    }
    
    if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
      console.error(`\nStack trace:\n${err.stack}`);
    } else {
      console.error('\nRun with SUPERCONNECT_E2E_VERBOSE=1 for full stack trace');
    }
    
    process.exit(1);
  });
}
