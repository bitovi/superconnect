#!/usr/bin/env node

/**
 * Stage 4: Per-component Code Connect generation.
 *
 * Inputs:
 *  - Figma components index + per-component JSON (from figma-scan.js)
 *  - Orienter JSONL (one JSON object per component describing needed files)
 *  - Repo root containing the source files to read
 *  - Prompt template for the single-codegen agent
 *
 * For each component:
 *  - Look up its orienter entry
 *  - Read the requested files from the repo
 *  - Invoke the agent with FIGMA + file context
 *  - Write the returned *.figma.tsx and a compact JSON log
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const { OpenAIAgentAdapter, ClaudeAgentAdapter } = require('../src/agent/agent-adapter');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');

const DEFAULT_CODECONNECT_DIR = 'codeConnect';
const defaultPromptPath = path.join(__dirname, '..', 'prompts', 'schema-mapping-agent.md');

const readJsonSafe = async (filePath) => {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
};

const sanitizeSlug = (value, fallback = 'component') => {
  const base = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
};

const toTokenName = (value) =>
  `<FIGMA_${(value || 'node')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}>`;

const stripExtension = (p) => p.replace(/\.[^/.]+$/, '');
const importExists = (repoRoot, importPath) => {
  if (!importPath) return false;
  const base = path.resolve(repoRoot, stripExtension(importPath));
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  return exts.some((ext) => fs.existsSync(`${base}${ext}`));
};

const normalizeImportPath = (schemaPath, fallbackPaths, repoRoot) => {
  if (!schemaPath) return schemaPath;
  const cleaned = schemaPath.replace(/^\.\/+/, '');
  if (importExists(repoRoot, cleaned)) return cleaned;
  for (const candidate of fallbackPaths || []) {
    const cleanCandidate = stripExtension(candidate);
    if (importExists(repoRoot, cleanCandidate)) return cleanCandidate;
  }
  return cleaned;
};

const buildFigmaNodeUrl = (fileKey, fileName, nodeId) => {
  if (!fileKey || !nodeId) return null;
  const safeName = fileName ? encodeURIComponent(fileName) : 'file';
  const normalizedNodeId = nodeId.replace(/:/g, '-');
  const encodedNodeId = encodeURIComponent(normalizedNodeId);
  return `https://www.figma.com/design/${fileKey}/${safeName}?node-id=${encodedNodeId}`;
};

const parseJsonLines = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
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
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

const normalizeOrienterRecord = (record = {}) => {
  const copy = { ...record };
  if (record.figma_component_id && !record.figmaComponentId) {
    copy.figmaComponentId = record.figma_component_id;
  }
  if (record.figma_component_name && !record.figmaComponentName) {
    copy.figmaComponentName = record.figma_component_name;
  }
  if (record.canonical_name && !record.canonicalName) {
    copy.canonicalName = record.canonical_name;
  }
  if (Array.isArray(record.files) && !record.files.length && Array.isArray(record.selected_files)) {
    copy.files = record.selected_files;
  }
  return copy;
};

const loadFigmaComponents = async (figmaDir) => {
  const entries = {};
  if (!fs.existsSync(figmaDir) || !fs.statSync(figmaDir).isDirectory()) return entries;
  const files = fs.readdirSync(figmaDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const file of files) {
    const full = path.join(figmaDir, file);
    const data = await readJsonSafe(full);
    if (!data) continue;
    const id = data.componentSetId || data.componentId || data.id || null;
    const name = data.componentName || data.name || null;
    const key = id || (name ? name.toLowerCase() : null);
    if (!key) continue;
    entries[key] = { data, source: full };
  }
  return entries;
};

const readRequestedFiles = async (repoRoot, requested) => {
  const uniquePaths = Array.from(new Set(requested.filter(Boolean)));
  const results = await Promise.all(
    uniquePaths.map(async (relPath) => {
      const absolute = path.join(repoRoot, relPath);
      try {
        const content = await fs.readFile(absolute, 'utf8');
        return { path: relPath, content };
      } catch (err) {
        return { path: relPath, error: err.message };
      }
    })
  );
  return results;
};

const buildAgentPayload = (promptText, componentMeta, componentJson, orienterEntry, files, figmaInfo) => {
  const componentData = componentJson?.data || null;
  const figmaCompact = componentData
    ? {
        componentSetId: componentData.componentSetId || componentData.componentId || null,
        componentName: componentData.componentName || componentData.name || null,
        variantProperties: componentData.variantProperties || null,
        variantValueEnums: componentData.variantValueEnums || null,
        componentProperties: componentData.componentProperties || null,
        totalVariants: componentData.totalVariants || null
      }
    : null;
  const serializedFiles = files
    .map((file) => {
      if (file.error) {
        return [`--- file: ${file.path} (missing) ---`, `(missing: ${file.error})`, '--- end file ---'].join('\n');
      }
      return [`--- file: ${file.path} ---`, file.content, '--- end file ---'].join('\n');
    })
    .join('\n\n');

  const figmaBlock = {
    indexEntry: {
      name: componentMeta?.name || null,
      id: componentMeta?.id || null,
      variantCount: componentMeta?.variantCount || null
    },
    componentJson: figmaCompact,
    figmaFile: figmaInfo?.file || null,
    nodeUrl: figmaInfo?.nodeUrl || null
  };

  return [
    promptText.trim(),
    '',
    '# Your Inputs (included below)',
    '',
    '## Figma component metadata',
    JSON.stringify(figmaBlock, null, 2),
    '',
    '## Orientation',
    JSON.stringify(orienterEntry, null, 2),
    '',
    '## Contents of selected files',
    serializedFiles,
    ''
  ].join('\n');
};

const extractJsonResponse = (text) => {
  if (!text) return null;
  const trimmed = text.trim();

  // Prefer the first fenced code block
  const fencedMatch = trimmed.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through
    }
  }

  // Try the whole output
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try from the first { to the last } as a last resort
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const slice = trimmed.slice(first, last + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const renderTsxFromSchema = (schema, figmaVariantProperties = null, figmaComponentProperties = null, tokenName = null) => {
  const lines = [];
  lines.push("import figma from '@figma/code-connect';");

  const named = Array.isArray(schema.reactImport?.named) ? schema.reactImport.named : [];
  const hasDefault = schema.reactImport?.default;
  const importPath = schema.reactImport?.path;
  if (importPath) {
    const parts = [];
    if (hasDefault) parts.push(hasDefault);
    if (named.length) parts.push(`{ ${named.join(', ')} }`);
    const importClause = parts.join(', ');
    lines.push(`import ${importClause || '{ }'} from '${importPath}';`);
  }

  const normalizeFigmaKey = (key) => (key || '').trim();
  const sanitizeJsName = (name) =>
    (name || '').replace(/^[.]/, '').replace(/[?]/g, '').replace(/[^a-zA-Z0-9_]/g, '');
  const baseProps = Array.isArray(schema.props) ? schema.props : [];
  const existingNames = new Set(baseProps.map((p) => p?.name).filter(Boolean));

  const inferredProps = Array.isArray(figmaComponentProperties)
    ? figmaComponentProperties
        .map((cp) => {
          const rawName = cp?.name || '';
          if (!rawName) return null;
          const isBoolean = rawName.trim().endsWith('?');
          const rawLower = rawName.toLowerCase();
          const normalizedKey = normalizeFigmaKey(rawName);
          const jsBase = sanitizeJsName(normalizedKey) || 'prop';
          const wantsChildren = !isBoolean && rawLower === 'label';
          const name = wantsChildren ? 'children' : isBoolean ? `${jsBase}Enabled` : jsBase;
          if (existingNames.has(name)) return null;
          const kind = isBoolean ? 'boolean' : cp?.type === 'STRING' || wantsChildren ? 'string' : 'instance';
          existingNames.add(name);
          return { name, figmaKey: rawName, kind };
        })
        .filter(Boolean)
    : [];
  const propEntries = [...baseProps, ...inferredProps];
  const variantKeySet =
    figmaVariantProperties && typeof figmaVariantProperties === 'object'
      ? new Set(Object.keys(figmaVariantProperties))
      : new Set();
  const componentPropKeySet = Array.isArray(figmaComponentProperties)
    ? new Set(figmaComponentProperties.map((p) => p?.name).filter(Boolean))
    : new Set();
  const allowedKeys = new Set([...variantKeySet, ...componentPropKeySet]);

  const filteredProps =
    allowedKeys.size > 0
      ? propEntries.filter((p) => !p.figmaKey || allowedKeys.has(p.figmaKey))
      : propEntries;
  const renderProp = (prop) => {
    if (prop.kind === 'enum') {
      const mapping = prop.valueMapping || {};
      const entries = Object.entries(mapping)
        .map(([k, v]) => `'${k}': '${v}'`)
        .join(', ');
      return `${prop.name}: figma.enum('${prop.figmaKey}', { ${entries} })`;
    }
    if (prop.kind === 'boolean') return `${prop.name}: figma.boolean('${prop.figmaKey}')`;
    if (prop.kind === 'string') return `${prop.name}: figma.string('${prop.figmaKey}')`;
    if (prop.kind === 'instance') return `${prop.name}: figma.instance('${prop.figmaKey}')`;
    return null;
  };

  const propLines = filteredProps
    .map(renderProp)
    .filter(Boolean)
    .map((line) => `      ${line},`);

  const exampleProps = schema.exampleProps && typeof schema.exampleProps === 'object' ? schema.exampleProps : {};

  const toJsLiteral = (value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return JSON.stringify(value);
  };

  const buildDestructured = (prop) => {
    const hasLiteral = Object.prototype.hasOwnProperty.call(exampleProps, prop.name);
    const literal = hasLiteral ? exampleProps[prop.name] : prop.defaultValue;
    const jsLit = toJsLiteral(literal);
    return jsLit !== undefined ? `${prop.name} = ${jsLit}` : prop.name;
  };

  const destructuredParams = filteredProps.map(buildDestructured).join(', ');

  const normalizedKey = (key) => (key || '').replace(/^[.]/, '').replace(/[?]$/, '');
  const booleanByKey = new Map(
    filteredProps
      .filter((p) => p.kind === 'boolean' && p.figmaKey)
      .map((p) => [normalizedKey(p.figmaKey), p.name])
  );
  const booleanByName = new Map(filteredProps.filter((p) => p.kind === 'boolean').map((p) => [p.name, p.name]));
  const inlineInstanceNames = new Set(['iconStart', 'iconEnd']);
  const inlineInstanceSegments = [];
  const instanceNames = new Set(filteredProps.filter((p) => p.kind === 'instance').map((p) => p.name));

  const buildExampleAttr = (prop) => {
    const name = prop.name;
    if (!name) return null;

    if (name === 'children') return null;

    // Gate instance props if a related boolean exists.
    if (prop.kind === 'instance') {
      const key = normalizedKey(prop.figmaKey || prop.name);
      const gateName =
        booleanByKey.get(key) ||
        booleanByName.get(`${name}Enabled`) ||
        booleanByName.get(`${key}Enabled`) ||
        booleanByName.get(key) ||
        null;

      if (inlineInstanceNames.has(name)) {
        const segment = gateName ? `{${gateName} ? ${name} : null}` : `{${name}}`;
        inlineInstanceSegments.push({ name, segment });
        return null;
      }

      if (gateName) {
        return `${name}={${gateName} ? ${name} : undefined}`;
      }
      return `${name}={${name}}`;
    }

    if (prop.kind === 'boolean') {
      const base = name.endsWith('Enabled') ? name.slice(0, -'Enabled'.length) : null;
      if (base && (instanceNames.has(base) || inlineInstanceNames.has(base))) {
        return null;
      }
      return `${name}={${name}}`;
    }

    return `${name}={${name}}`;
  };

  const exampleAttrs = filteredProps
    .map(buildExampleAttr)
    .filter(Boolean)
    .map((attr) => ` ${attr}`)
    .join('');

  const hasChildren = filteredProps.some((p) => p.name === 'children');
  const startSegments = inlineInstanceSegments.filter(({ name }) => name.toLowerCase().includes('start')).map((s) => s.segment);
  const endSegments = inlineInstanceSegments.filter(({ name }) => name.toLowerCase().includes('end')).map((s) => s.segment);
  const middleSegments = inlineInstanceSegments
    .filter(({ name }) => !name.toLowerCase().includes('start') && !name.toLowerCase().includes('end'))
    .map((s) => s.segment);
  const childParts = [...startSegments, ...middleSegments];
  if (hasChildren) childParts.push('{children}');
  childParts.push(...endSegments);
  const childExpr = childParts.join(' ');

  lines.push('');
  lines.push('/**');
  lines.push(` * Code Connect mapping for ${schema.figmaComponentName || schema.reactComponentName || 'Component'}`);
  lines.push(' */');
  lines.push(
    `figma.connect(${schema.reactComponentName}, '${tokenName || schema.figmaNodeUrl}', {`
  );
  lines.push('  props: {');
  propLines.forEach((l) => lines.push(l));
  lines.push('  },');

  const exampleParam = 'props';
  if (destructuredParams.trim()) {
    lines.push(`  example: (${exampleParam}) => {`);
    lines.push(`    const { ${destructuredParams} } = ${exampleParam} || {};`);
    lines.push(`    return (`);
    lines.push(`      <${schema.reactComponentName}${exampleAttrs}>${childExpr}</${schema.reactComponentName}>`);
    lines.push('    );');
    lines.push('  },');
  } else {
    lines.push(`  example: (${exampleParam}) => (`);
    lines.push(`    <${schema.reactComponentName}${exampleAttrs}>${childExpr}</${schema.reactComponentName}>`);
    lines.push('  ),');
  }
  lines.push('});');

  return lines.join('\n');
};

const writeCodeConnectFile = async (repoRoot, dir, fileName, contents) => {
  const safeDir = path.join(repoRoot, dir || DEFAULT_CODECONNECT_DIR);
  await fs.ensureDir(safeDir);
  const target = path.join(safeDir, fileName);
  await fs.writeFile(target, contents, 'utf8');
  return target;
};

const writeLog = async (logDir, name, entry) => {
  await fs.ensureDir(logDir);
  const file = path.join(logDir, `${sanitizeSlug(name)}-codegen-result.json`);
  await fs.writeJson(file, entry, { spaces: 2 });
  return file;
};

const buildAdapter = (config) => {
  const backend = config.agentBackend;
  const maxTokens = config.agentMaxTokens || undefined;
  if (backend === 'openai') {
    return new OpenAIAgentAdapter({
      model: config.agentModel || undefined,
      logDir: config.agentLogDir,
      cwd: config.repo,
      maxTokens
    });
  }
  return new ClaudeAgentAdapter({
    model: config.agentModel || undefined,
    logDir: config.agentLogDir,
    cwd: config.repo,
    maxTokens
  });
};

const parseArgs = (argv) => {
  const program = new Command();
  program
    .name('run-codegen')
    .requiredOption('--figma-index <file>', 'Path to figma-components-index.json')
    .requiredOption('--orienter <file>', 'Orienter JSONL output (one JSON object per line)')
    .option('--force', 'Overwrite existing *.figma.tsx files', false)
    .option('--agent-backend <value>', 'Agent backend (openai|claude)', 'claude')
    .option('--agent-model <value>', 'Agent model for SDK backends')
    .option('--agent-max-tokens <value>', 'Max output tokens for agent responses')
    .option('--only <list>', 'Comma-separated component names/IDs (globs allowed)')
    .option('--exclude <list>', 'Comma-separated component names/IDs to skip (globs allowed)')
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const figmaIndexPath = path.resolve(opts.figmaIndex);
  const superconnectDir = path.dirname(figmaIndexPath);
  const repoRoot = path.dirname(superconnectDir);
  return {
    repo: repoRoot,
    figmaDir: path.join(superconnectDir, 'figma-components'),
    figmaIndex: figmaIndexPath,
    orienter: path.resolve(opts.orienter),
    promptPath: defaultPromptPath,
    codeConnectDir: DEFAULT_CODECONNECT_DIR,
    logDir: path.join(superconnectDir, 'codegen-logs'),
    agentLogDir: path.join(superconnectDir, 'mapping-agent-logs'),
    force: Boolean(opts.force),
    agentBackend: (opts.agentBackend || 'claude').toLowerCase(),
    agentModel: opts.agentModel || undefined,
    agentMaxTokens: parseInt(opts.agentMaxTokens, 10) || undefined,
    only: typeof opts.only === 'string' ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : [],
    exclude: typeof opts.exclude === 'string' ? opts.exclude.split(',').map((s) => s.trim()).filter(Boolean) : []
  };
};

const findComponentMeta = (figmaIndex, orienterEntry) => {
  if (!figmaIndex?.components) return null;
  const byId = orienterEntry.figmaComponentId
    ? figmaIndex.components.find((c) => c.id === orienterEntry.figmaComponentId)
    : null;
  if (byId) return byId;
  const targetName = orienterEntry.figmaComponentName || orienterEntry.canonicalName || null;
  if (!targetName) return null;
  return figmaIndex.components.find((c) => (c.name || '').toLowerCase() === targetName.toLowerCase()) || null;
};

const globToRegex = (pattern) => {
  const escaped = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${escaped}$`, 'i');
};

const buildMatcher = (tokens = [], defaultResult = false) => {
  const predicates = [];
  tokens.forEach((token) => {
    const trimmed = (token || '').trim();
    if (!trimmed) return;
    const hasGlob = trimmed.includes('*') || trimmed.includes('?');
    if (hasGlob) {
      const re = globToRegex(trimmed);
      predicates.push(({ name }) => Boolean(name && re.test(name)));
      return;
    }
    predicates.push(({ id, name }) => {
      if (id && id === trimmed) return true;
      return (name || '').toLowerCase() === trimmed.toLowerCase();
    });
  });
  return (identity) => (predicates.length === 0 ? defaultResult : predicates.some((fn) => fn(identity)));
};

const filterOrienterEntries = (entries, figmaIndex, onlyTokens = [], excludeTokens = []) => {
  const allow = buildMatcher(onlyTokens, true);
  const block = buildMatcher(excludeTokens, false);
  const filtered = [];
  for (const entry of entries) {
    const meta = findComponentMeta(figmaIndex, entry);
    const identity = {
      id: meta?.id || entry.figmaComponentId || null,
      name: meta?.name || entry.figmaComponentName || entry.canonicalName || null
    };
    if (block(identity)) continue;
    if (!allow(identity)) continue;
    filtered.push(entry);
  }
  return filtered;
};

const processOrienterEntry = async (orienterEntry, ctx) => {
  const normalized = normalizeOrienterRecord(orienterEntry);
  if (normalized.status !== 'mapped') return null;

  const key = normalized.figmaComponentId || (normalized.figmaComponentName || '').toLowerCase();
  if (key && ctx.seen.has(key)) return null;
  if (key) ctx.seen.add(key);

  const componentMeta = findComponentMeta(ctx.figmaIndex, normalized) || {};
  const orienterName =
    normalized.figmaComponentName || normalized.canonicalName || normalized.figmaComponentId || 'component';
  const logBaseName = componentMeta.name || componentMeta.id || orienterName || 'component';

  const requiredPaths = Array.isArray(normalized.files)
    ? normalized.files.map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
    : [];
  if (requiredPaths.length === 0) {
    const entry = {
      figmaName: componentMeta.name || normalized.figmaComponentName || null,
      figmaId: componentMeta.id || normalized.figmaComponentId || null,
      status: 'skipped',
      reason: 'Orienter provided no files to read'
    };
    await writeLog(ctx.logDir, logBaseName, entry);
    ctx.summaries.push(entry);
    return entry;
  }

  const files = await readRequestedFiles(ctx.repo, requiredPaths);
  const missingFiles = files.filter((f) => f.error).map((f) => f.path);

  const componentKey =
    componentMeta.id ||
    normalized.figmaComponentId ||
    (componentMeta.name ? componentMeta.name.toLowerCase() : orienterName ? orienterName.toLowerCase() : null);
  const componentJson = componentKey ? ctx.figmaComponents[componentKey] || null : null;

  const filesLabel = requiredPaths.map((p) => codeColor(p)).join(', ');
  console.log(`Generating Code Connect mapping for ${generatedColor(logBaseName)}`);
  console.log(`    ... looking at ${filesLabel}`);

  const figmaInfo = {
    file: {
      key: ctx.figmaIndex.fileKey || null,
      name: ctx.figmaIndex.fileName || null
    },
    nodeUrl: buildFigmaNodeUrl(ctx.figmaIndex.fileKey, ctx.figmaIndex.fileName, componentMeta.id || null)
  };

  const payload = buildAgentPayload(ctx.promptText, componentMeta, componentJson, normalized, files, figmaInfo);

  const agentResult = await ctx.agent.codegen({
    payload,
    cwd: ctx.repo,
    logLabel: logBaseName,
    logDir: ctx.agentLogDir
  });
  const rawAgentOutput = agentResult.stdout || agentResult.stderr || '';
  const parsed = extractJsonResponse(rawAgentOutput);

  const logEntry = {
    figmaName: componentMeta.name || null,
    figmaId: componentMeta.id || null,
    status: parsed?.status || 'error',
    reason: parsed?.reason || undefined,
    confidence: parsed?.confidence ?? undefined,
    reactComponentName: parsed?.reactComponentName || parsed?.reactName || null,
    missingFiles,
    agentExitCode: agentResult.code
  };

  if (parsed?.status === 'built') {
    const schema = parsed;
    const resolvedImportPath = normalizeImportPath(schema.reactImport?.path, requiredPaths, ctx.repo);
    if (schema.reactImport && resolvedImportPath) {
      schema.reactImport.path = resolvedImportPath;
    }

    const fileName =
      schema.codeConnectFileName ||
      `${sanitizeSlug(componentMeta.name || normalized.figmaComponentName || 'component')}.figma.tsx`;
    const figmaToken = schema.figmaComponentName ? toTokenName(schema.figmaComponentName) : null;
    const tsx = renderTsxFromSchema(
      schema,
      componentJson?.data?.variantProperties || componentJson?.variantProperties || null,
      componentJson?.data?.componentProperties || componentJson?.componentProperties || null,
      figmaToken
    );
    const targetPath = path.join(ctx.repo, ctx.codeConnectDir, fileName);
    const exists = fs.existsSync(targetPath);
    if (exists && !ctx.force) {
      logEntry.status = 'skipped';
      logEntry.reason =
        logEntry.reason || 'Existing Code Connect file present (rerun with --force to overwrite)';
      logEntry.codeConnectFile = path.relative(ctx.repo, targetPath);
    } else {
      const written = await writeCodeConnectFile(ctx.repo, ctx.codeConnectDir, fileName, tsx);
      logEntry.status = 'built';
      logEntry.codeConnectFile = path.relative(ctx.repo, written);
      logEntry.overwritten = exists && ctx.force;
    }
  }

  if (!parsed && logEntry.status !== 'built') {
    const snippet = (rawAgentOutput || '').split('\n').slice(-10).join(' ').trim();
    const suffix = snippet ? ` (tail: ${snippet.slice(0, 200)})` : '';
    logEntry.reason =
      logEntry.reason || `Agent response was not valid JSON (see mapping-agent log)${suffix}`;
  } else if (parsed && logEntry.status !== 'built' && !logEntry.reason) {
    logEntry.reason = 'Agent returned a non-built status without a reason.';
  }

  if (logEntry.reason === undefined) delete logEntry.reason;
  if (logEntry.confidence === undefined) delete logEntry.confidence;
  await writeLog(ctx.logDir, logBaseName, logEntry);
  ctx.summaries.push(logEntry);
  return logEntry;
};

async function main() {
  const config = parseArgs(process.argv);
  if (config.force) {
    [config.logDir, config.agentLogDir].forEach((dir) => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const [figmaIndex, figmaComponents, promptText] = await Promise.all([
    readJsonSafe(config.figmaIndex),
    loadFigmaComponents(config.figmaDir),
    fs.readFile(config.promptPath, 'utf8')
  ]);

  if (!figmaIndex?.components) {
    console.error(`❌ Could not read figma index: ${config.figmaIndex}`);
    process.exit(1);
  }

  const orienterRecords = await parseJsonLines(config.orienter);
  const agent = buildAdapter(config);
  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) return;
    stopRequested = true;
    console.log('\nReceived SIGINT. Finishing current component then stopping further codegen...');
  });
  const ctx = {
    repo: config.repo,
    figmaIndex,
    figmaComponents,
    promptText,
    codeConnectDir: config.codeConnectDir,
    logDir: config.logDir,
    agentLogDir: config.agentLogDir,
    force: config.force,
    summaries: [],
    agent,
    seen: new Set()
  };

  const normalizedOrienter = orienterRecords.map(normalizeOrienterRecord).filter((rec) => rec.status === 'mapped');
  const filteredOrienter = filterOrienterEntries(normalizedOrienter, figmaIndex, config.only, config.exclude);
  if (filteredOrienter.length !== normalizedOrienter.length) {
    const removed = normalizedOrienter.length - filteredOrienter.length;
    console.log(
      `Filtering orienter entries: kept ${filteredOrienter.length} of ${normalizedOrienter.length} (${removed} filtered out)`
    );
  }

  for (const orienterEntry of filteredOrienter) {
    if (stopRequested) {
      console.log('Stopping codegen early due to interrupt request.');
      break;
    }
    await processOrienterEntry(orienterEntry, ctx);
  }

  const built = ctx.summaries.filter((s) => s.status === 'built');
  const skipped = ctx.summaries.filter((s) => s.status !== 'built');
  console.log(`Done. Built ${built.length}, skipped ${skipped.length}. Logs → ${config.logDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
