#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const EXT_TO_PARSER = {
  '.figma.tsx': 'react',
  '.figma.ts': 'html'
};

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const inputs = resolveInputs(args);
  const files = inputs.files;
  if (files.length === 0) {
    fail('No Code Connect files found');
  }

  const cli = resolveFigmaCLI(process.cwd());
  if (!cli) {
    fail([
      'Figma Code Connect CLI not found',
      'Install it locally in the repo, then re-run validation',
      'Example: pnpm add -D @figma/code-connect'
    ].join('\n'));
  }

  const results = files.map((file) => validateFile({
    codePath: file.codePath,
    parser: file.parser,
    evidencePath: file.evidencePath,
    skipPrecheck: inputs.skipPrecheck,
    cli
  }));

  const failures = results.filter((result) => !result.valid);
  if (failures.length === 0) {
    console.log('Validation passed');
    process.exit(0);
  }

  failures.forEach((result) => {
    console.error(`\n${result.codePath}`);
    result.errors.forEach((error) => console.error(`- ${error}`));
  });
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    code: null,
    codeDir: null,
    evidence: null,
    evidenceDir: null,
    parser: null,
    skipPrecheck: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--code') {
      args.code = argv[++i];
      continue;
    }
    if (arg === '--code-dir') {
      args.codeDir = argv[++i];
      continue;
    }
    if (arg === '--evidence') {
      args.evidence = argv[++i];
      continue;
    }
    if (arg === '--evidence-dir') {
      args.evidenceDir = argv[++i];
      continue;
    }
    if (arg === '--parser') {
      args.parser = argv[++i];
      continue;
    }
    if (arg === '--skip-precheck') {
      args.skipPrecheck = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  validate_code_connect.js --code <file> --evidence <file> [--parser react|html]
  validate_code_connect.js --code-dir <dir> --evidence-dir <dir> [--parser react|html]

Options:
  --skip-precheck   Skip figma.* key validation
  --parser          Force parser for all files (react or html)
  --help            Show this help
`);
}

function resolveInputs(args) {
  if (!args.code && !args.codeDir) {
    fail('Provide --code or --code-dir');
  }

  if (args.code && args.codeDir) {
    fail('Use only one of --code or --code-dir');
  }

  const files = args.code ? [resolveSingleFile(args)] : resolveDirFiles(args);
  const parserSet = new Set(files.map((file) => file.parser));

  if (parserSet.size > 1) {
    fail('Mixed React and HTML parsers detected, validate separately');
  }

  return {
    files,
    skipPrecheck: args.skipPrecheck
  };
}

function resolveSingleFile(args) {
  const codePath = path.resolve(args.code);
  const parser = resolveParser(codePath, args.parser);
  const evidencePath = resolveEvidencePath({
    codePath,
    evidence: args.evidence,
    evidenceDir: args.evidenceDir
  });

  return { codePath, parser, evidencePath };
}

function resolveDirFiles(args) {
  const codeDir = path.resolve(args.codeDir);
  const files = collectCodeFiles(codeDir);

  return files.map((codePath) => {
    const parser = resolveParser(codePath, args.parser);
    const evidencePath = resolveEvidencePath({
      codePath,
      evidence: args.evidence,
      evidenceDir: args.evidenceDir
    });

    return { codePath, parser, evidencePath };
  });
}

function collectCodeFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }

      const parser = parserFromFilename(entry.name);
      if (parser) {
        results.push(fullPath);
      }
    });
  }

  return results.sort();
}

function resolveParser(codePath, override) {
  if (override) {
    if (override !== 'react' && override !== 'html') {
      fail(`Invalid parser: ${override}`);
    }
    return override;
  }

  const parser = parserFromFilename(path.basename(codePath));
  if (!parser) {
    fail(`Cannot infer parser from file name: ${codePath}`);
  }
  return parser;
}

function parserFromFilename(name) {
  if (name.endsWith('.figma.tsx')) return 'react';
  if (name.endsWith('.figma.ts')) return 'html';
  return null;
}

function resolveEvidencePath({ codePath, evidence, evidenceDir }) {
  if (evidence) {
    return path.resolve(evidence);
  }
  if (!evidenceDir) {
    return null;
  }

  const baseName = path.basename(codePath)
    .replace(/\.figma\.tsx$/, '')
    .replace(/\.figma\.ts$/, '');
  return path.resolve(evidenceDir, `${baseName}.json`);
}

function validateFile({ codePath, parser, evidencePath, skipPrecheck, cli }) {
  const code = fs.readFileSync(codePath, 'utf8');
  const errors = [];

  if (!skipPrecheck) {
    if (!evidencePath) {
      errors.push('Missing evidence file, pass --evidence or --evidence-dir');
    } else if (!fs.existsSync(evidencePath)) {
      errors.push(`Evidence file not found: ${evidencePath}`);
    } else {
      const evidence = readEvidenceFile(evidencePath);
      const keySets = buildValidKeySets(evidence);
      const calls = extractFigmaCalls(code);
      const callErrors = validateCalls(calls, keySets);
      errors.push(...callErrors);
    }
  }

  if (errors.length === 0) {
    const cliResult = validateWithFigmaCLI({ code, parser, cli });
    if (!cliResult.valid) {
      errors.push(...cliResult.errors);
    }
  }

  return {
    codePath,
    valid: errors.length === 0,
    errors
  };
}

function readEvidenceFile(evidencePath) {
  const raw = fs.readFileSync(evidencePath, 'utf8');
  const parsed = JSON.parse(raw);
  return normalizeEvidence(parsed);
}

function normalizeEvidence(raw) {
  return {
    variantProperties: normalizeVariantProperties(raw.variantProperties || raw.variant_properties),
    componentProperties: normalizeComponentProperties(raw.componentProperties || raw.component_properties),
    textLayers: normalizeLayerList(raw.textLayers || raw.text_layers),
    slotLayers: normalizeLayerList(raw.slotLayers || raw.slot_layers)
  };
}

function normalizeVariantProperties(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    return value.reduce((acc, entry) => {
      if (entry && entry.name) {
        acc[entry.name] = Array.isArray(entry.values) ? entry.values : [];
      }
      return acc;
    }, {});
  }
  if (typeof value === 'object') {
    return value;
  }
  return {};
}

function normalizeComponentProperties(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function normalizeLayerList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [];
}

function extractFigmaCalls(code) {
  const calls = [];
  const pattern = /figma\.(\w+)\(\s*(['"`])([^'"`]+)\2/g;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const helper = match[1];
    if (helper === 'connect') continue;
    const key = match[3];
    const line = lineNumberAt(code, match.index);
    calls.push({ helper, key, line });
  }

  return calls;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function buildValidKeySets(figmaEvidence) {
  const stringKeys = new Set();
  const booleanKeys = new Set();
  const enumKeys = new Set();
  const instanceKeys = new Set();
  const textLayerNames = new Set();
  const slotLayerNames = new Set();

  const variantProps = figmaEvidence.variantProperties || {};
  Object.keys(variantProps).forEach((key) => {
    const normalized = normalizeKey(key);
    enumKeys.add(normalized);
    stringKeys.add(normalized);
    const values = variantProps[key];
    if (isBooleanVariant(values)) {
      booleanKeys.add(normalized);
    }
  });

  const componentProps = figmaEvidence.componentProperties || [];
  componentProps.forEach((prop) => {
    if (!prop || !prop.name) return;
    const normalized = normalizeKey(prop.name);
    switch (prop.type) {
      case 'BOOLEAN':
        booleanKeys.add(normalized);
        break;
      case 'INSTANCE_SWAP':
        instanceKeys.add(normalized);
        break;
      case 'TEXT':
      case 'STRING':
        stringKeys.add(normalized);
        break;
      default:
        stringKeys.add(normalized);
    }
  });

  (figmaEvidence.textLayers || []).forEach((layer) => {
    const name = typeof layer === 'string' ? layer : layer?.name;
    if (name) textLayerNames.add(normalizeKey(name));
  });

  (figmaEvidence.slotLayers || []).forEach((layer) => {
    const name = typeof layer === 'string' ? layer : layer?.name;
    if (name) slotLayerNames.add(normalizeKey(name));
  });

  return {
    stringKeys,
    booleanKeys,
    enumKeys,
    instanceKeys,
    textLayerNames,
    slotLayerNames
  };
}

function normalizeKey(key) {
  return (key || '')
    .replace(/^\./, '')
    .replace(/\?$/, '')
    .toLowerCase()
    .trim();
}

function isBooleanVariant(values) {
  if (!Array.isArray(values) || values.length !== 2) return false;
  const normalized = values.map((value) => String(value).toLowerCase()).sort();
  const pairs = [
    ['false', 'true'],
    ['no', 'yes'],
    ['off', 'on']
  ];
  return pairs.some((pair) => normalized[0] === pair[0] && normalized[1] === pair[1]);
}

function validateCalls(calls, keySets) {
  const errors = [];
  calls.forEach((call) => {
    const error = validateCall(call, keySets);
    if (error) errors.push(error);
  });
  return errors;
}

function validateCall(call, keySets) {
  const { helper, key, line } = call;
  const normalizedKey = normalizeKey(key);

  switch (helper) {
    case 'string':
      if (!keySets.stringKeys.has(normalizedKey) && !keySets.enumKeys.has(normalizedKey)) {
        return `Line ${line}: figma.string('${key}') is not a valid TEXT property or variant`;
      }
      break;
    case 'boolean':
      if (!keySets.booleanKeys.has(normalizedKey)) {
        return `Line ${line}: figma.boolean('${key}') is not a valid BOOLEAN property`;
      }
      break;
    case 'enum':
      if (!keySets.enumKeys.has(normalizedKey)) {
        return `Line ${line}: figma.enum('${key}', ...) is not a valid variant property`;
      }
      break;
    case 'instance':
      if (!keySets.instanceKeys.has(normalizedKey)) {
        return `Line ${line}: figma.instance('${key}') is not a valid INSTANCE_SWAP property`;
      }
      break;
    case 'textContent':
      if (!keySets.textLayerNames.has(normalizedKey)) {
        return `Line ${line}: figma.textContent('${key}') is not a known text layer name`;
      }
      break;
    case 'children':
      if (!keySets.slotLayerNames.has(normalizedKey)) {
        return `Line ${line}: figma.children('${key}') is not a known slot layer name`;
      }
      break;
    case 'nestedProps':
    case 'className':
      break;
    default:
      break;
  }

  return null;
}

function resolveFigmaCLI(cwd) {
  if (process.env.FIGMA_CLI_PATH && fs.existsSync(process.env.FIGMA_CLI_PATH)) {
    return { type: 'node', path: process.env.FIGMA_CLI_PATH };
  }

  const localCli = path.join(cwd, 'node_modules', '@figma', 'code-connect', 'bin', 'figma');
  if (fs.existsSync(localCli)) {
    return { type: 'node', path: localCli };
  }

  try {
    const req = createRequire(path.join(cwd, 'package.json'));
    const moduleEntry = req.resolve('@figma/code-connect');
    const pkgRoot = findPackageRoot(moduleEntry);
    const cliPath = path.join(pkgRoot, 'bin', 'figma');
    if (fs.existsSync(cliPath)) {
      return { type: 'node', path: cliPath };
    }
  } catch {
    // ignore
  }

  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const whichResult = spawnSync(whichCmd, ['figma'], { encoding: 'utf8' });
  if (whichResult.status === 0) {
    const match = (whichResult.stdout || '').split(/\r?\n/).find(Boolean);
    if (match) {
      return { type: 'path', path: match };
    }
  }

  return null;
}

function findPackageRoot(startPath) {
  let current = path.dirname(startPath);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.dirname(startPath);
}

function validateWithFigmaCLI({ code, parser, cli }) {
  const ext = parser === 'react' ? '.figma.tsx' : '.figma.ts';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-connect-validate-'));
  const tempFile = path.join(tempDir, `temp${ext}`);
  const tempConfig = path.join(tempDir, 'figma.config.json');

  fs.writeFileSync(tempFile, code, 'utf8');
  const config = {
    codeConnect: {
      parser,
      include: [`*${ext}`]
    }
  };
  fs.writeFileSync(tempConfig, JSON.stringify(config, null, 2));

  const result = runFigmaCLI(cli, [
    'connect',
    'parse',
    '-c',
    path.basename(tempConfig),
    '--exit-on-unreadable-files'
  ], {
    cwd: tempDir,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  cleanupTemp(tempDir);

  if (result.status === 0 && !String(result.stderr || '').includes('ParserError')) {
    return { valid: true, errors: [] };
  }

  const errors = extractErrors(result.stdout, result.stderr);
  if (errors.length === 0) {
    return {
      valid: false,
      errors: [
        'Figma CLI validation failed with no parseable errors',
        `Exit code: ${result.status}`
      ]
    };
  }

  return { valid: false, errors };
}

function runFigmaCLI(cli, args, options) {
  if (cli.type === 'node') {
    return spawnSync(process.execPath, [cli.path, ...args], options);
  }
  return spawnSync(cli.path, args, options);
}

function cleanupTemp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function extractErrors(stdout = '', stderr = '') {
  const errors = [];
  const combined = `${stdout}\n${stderr}`;

  const parserErrorPattern = /ParserError[\s\S]*?:\s*([^\n]+)\s*\n\s*->\s*[^:]+:(\d+):(\d+)/g;
  let match;
  while ((match = parserErrorPattern.exec(combined)) !== null) {
    const message = match[1].trim();
    const line = match[2];
    errors.push(`Line ${line}: ${message}`);
  }

  const propMappingPattern = /Could not find prop mapping for (\w+)/g;
  while ((match = propMappingPattern.exec(combined)) !== null) {
    const propName = match[1];
    const alreadyCaptured = errors.some((error) => error.includes(propName));
    if (!alreadyCaptured) {
      errors.push(`Prop '${propName}' used in example() but not defined in props object`);
    }
  }

  if (combined.includes('Exiting due to unreadable files') && errors.length === 0) {
    errors.push('Code Connect file could not be parsed by Figma CLI');
  }

  return errors;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
