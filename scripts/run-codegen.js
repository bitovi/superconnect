#!/usr/bin/env node

/**
 * Stage 4: Per-component Code Connect generation.
 *
 * Uses direct codegen approach where agents generate complete .figma.tsx/.figma.ts files
 * with built-in validation and retry logic.
 *
 * Inputs:
 *  - Figma components index + per-component JSON (from figma-scan.js)
 *  - Orienter JSONL (one JSON object per component describing needed files)
 *  - Repo root containing the source files to read
 *
 * For each component:
 *  - Look up its orienter entry
 *  - Read the requested files from the repo
 *  - Build figma evidence and orientation data
 *  - Call direct codegen (processComponent) which handles:
 *    - Generating code with agent
 *    - Validating against Figma metadata
 *    - Retrying on validation failure
 *  - Write the generated *.figma.tsx/.figma.ts and a compact JSON log
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const { OpenAIAgentAdapter, ClaudeAgentAdapter } = require('../src/agent/agent-adapter');
const { figmaColor, codeColor, generatedColor, highlight } = require('./colors');
const { processComponent: processReactComponent } = require('../src/react/direct-codegen');
const { processComponent: processAngularComponent } = require('../src/angular/direct-codegen');

const DEFAULT_CODECONNECT_DIR = 'codeConnect';

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

const packageJsonCache = new Map();
const resolveExistingPath = (repoRoot, relPath) => {
  if (!relPath) return null;
  const base = path.resolve(repoRoot, stripExtension(relPath));
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  for (const ext of exts) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const findNearestPackageJson = (absPath, repoRoot) => {
  const root = path.resolve(repoRoot);
  let dir = path.resolve(absPath);
  while (dir && dir.startsWith(root)) {
    const candidate = path.join(dir, 'package.json');
    if (packageJsonCache.has(candidate)) return packageJsonCache.get(candidate);
    if (fs.existsSync(candidate)) {
      try {
        const pkg = fs.readJsonSync(candidate);
        const info = { pkg, dir };
        packageJsonCache.set(candidate, info);
        return info;
      } catch {
        packageJsonCache.set(candidate, null);
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

const maybeRewriteToPackageImport = (absPath, repoRoot) => {
  if (!absPath) return null;
  const pkgInfo = findNearestPackageJson(absPath, repoRoot);
  if (!pkgInfo?.pkg?.name) return null;
  const relToPkg = path.relative(pkgInfo.dir, absPath);
  if (relToPkg.startsWith('..') || relToPkg === '') return null;
  const segments = relToPkg.split(path.sep);
  if (segments[0] !== 'src') return null;

  const exportsField = pkgInfo.pkg.exports;
  const hasExports = exportsField && typeof exportsField === 'object';
  const hasRootOrWildcard =
    hasExports && (Object.prototype.hasOwnProperty.call(exportsField, '.') || Object.prototype.hasOwnProperty.call(exportsField, './*'));
  if (!hasRootOrWildcard) return null;

  return pkgInfo.pkg.name;
};

const normalizeImportPath = (schemaPath, fallbackPaths, repoRoot) => {
  if (!schemaPath) return schemaPath;
  const cleaned = schemaPath.replace(/^\.\/+/, '');
  const resolved = resolveExistingPath(repoRoot, cleaned);

  let chosenRel = stripExtension(cleaned);
  let chosenAbs = resolved;

  if (!chosenAbs) {
    for (const candidate of fallbackPaths || []) {
      const cleanCandidate = stripExtension(candidate);
      const abs = resolveExistingPath(repoRoot, cleanCandidate);
      if (abs) {
        chosenRel = cleanCandidate;
        chosenAbs = abs;
        break;
      }
    }
  }

  if (!chosenAbs) return cleaned;

  const pkgImport = maybeRewriteToPackageImport(chosenAbs, repoRoot);
  if (pkgImport) return pkgImport;
  return chosenRel;
};

const cleanPropName = (raw) => (raw || '').replace(/^['"`]/, '').replace(/['"`]$/, '').trim();
const extractPropNamesFromContent = (content = '') => {
  const names = new Set();
  const add = (n) => {
    const cleaned = cleanPropName(n);
    if (!cleaned) return;
    if (cleaned.startsWith('...')) return;
    names.add(cleaned);
  };

  const typeBlockRegex = /(interface|type)\s+[A-Za-z0-9_$]+Props?\s*=?\s*{([\s\S]*?)}\s*/g;
  for (const match of content.matchAll(typeBlockRegex)) {
    const body = match[2] || '';
    body
      .split('\n')
      .map((line) => line.trim())
      .forEach((line) => {
        const propMatch = line.match(/^(?:readonly\s+)?(['"`]?[A-Za-z0-9_$.-]+['"`]?)\s*[\?:]/);
        if (propMatch) add(propMatch[1]);
      });
  }

  const destructureRegexes = [
    /{([^}]+)}\s*=\s*[^;\n]*\bprops\b/g,
    /function\s+[A-Za-z0-9_$]+\s*\(\s*{([^}]+)}\s*[:)]/g
  ];
  destructureRegexes.forEach((re) => {
    for (const match of content.matchAll(re)) {
      const body = match[1] || '';
      body
        .split(',')
        .map((segment) => segment.trim())
        .forEach((segment) => {
          const [lhs] = segment.split(/[:=]/);
          if (lhs) add(lhs.trim());
        });
    }
  });

  if (names.size === 0) names.add('children');
  return names;
};

const coerceSchemaToApiSurface = (schema, propNames) => {
  if (!schema || schema.status !== 'built') return schema;
  if (!propNames || propNames.size === 0) return schema;

  const hasProp = (name) => propNames.has(name);
  const fromProps = Array.isArray(schema.props) ? schema.props : [];
  const exampleProps = schema.exampleProps && typeof schema.exampleProps === 'object' ? schema.exampleProps : {};

  const chooseTarget = (candidates = []) => candidates.find((c) => hasProp(c)) || null;
  const iconSurface = {
    left: chooseTarget(['leftIcon', 'startIcon', 'leadingIcon']),
    right: chooseTarget(['rightIcon', 'endIcon', 'trailingIcon']),
    single: chooseTarget(['icon'])
  };

  const booleanTargets = {
    state: chooseTarget(['isDisabled', 'disabled']),
    disabled: chooseTarget(['isDisabled']),
    isDisabled: chooseTarget(['disabled']),
    loading: chooseTarget(['isLoading']),
    isLoading: chooseTarget(['loading'])
  };

  const usedNames = new Set(fromProps.map((p) => p?.name).filter(Boolean));
  const coercedProps = [];
  const appliedRenames = new Map();

  const inferIconTarget = (prop) => {
    if (!prop || prop.kind !== 'instance') return null;
    if (hasProp(prop.name)) return null;
    const key = (prop.figmaKey || prop.name || '').toLowerCase();
    const isStart =
      key.includes('start') || key.includes('left') || key.includes('leading') || key.includes('prefix');
    const isEnd =
      key.includes('end') || key.includes('right') || key.includes('trailing') || key.includes('suffix');
    if (isStart && iconSurface.left) return iconSurface.left;
    if (isEnd && iconSurface.right) return iconSurface.right;
    if (!isStart && !isEnd && iconSurface.single) return iconSurface.single;
    return null;
  };

  fromProps.forEach((prop) => {
    if (!prop || !prop.name) return;
    const iconTarget = inferIconTarget(prop);
    const booleanTarget = prop.kind === 'boolean' && !hasProp(prop.name) ? booleanTargets[prop.name] : null;
    const target = iconTarget || booleanTarget || null;
    if (!target) {
      coercedProps.push(prop);
      return;
    }
    if (usedNames.has(target)) return;
    usedNames.add(target);
    coercedProps.push({ ...prop, name: target });
    appliedRenames.set(prop.name, target);
  });

  if (appliedRenames.size === 0) return schema;

  const finalNames = new Set(coercedProps.map((p) => p?.name).filter(Boolean));
  const coercedExampleProps = Object.entries(exampleProps).reduce((acc, [key, value]) => {
    const target = appliedRenames.get(key);
    const finalKey = target && finalNames.has(target) ? target : key;
    acc[finalKey] = value;
    return acc;
  }, {});

  return { ...schema, props: coercedProps, exampleProps: coercedExampleProps };
};

const extractPropNamesFromFiles = (files = []) => {
  const names = new Set();
  files
    .filter((f) => f && !f.error && typeof f.content === 'string')
    .forEach((file) => {
      const props = extractPropNamesFromContent(file.content);
      props.forEach((name) => names.add(name));
    });
  return names;
};

const sanitizePropKeyForMatch = (key) =>
  (key || '')
    .trim()
    .toLowerCase()
    .replace(/^[.]/, '')
    .replace(/[?]/g, '')
    .replace(/[^a-z0-9_]/g, '');

const TEXT_SURFACE_KEYS = new Set(['children', 'label', 'text', 'content', 'title']);
const hasTextualSurface = (propHints) => {
  if (!propHints || propHints.size === 0) return false;
  return Array.from(propHints).some((name) => TEXT_SURFACE_KEYS.has(sanitizePropKeyForMatch(name)));
};

const PSEUDO_STATE_AXIS_KEYS = new Set(['state', 'interaction']);
const isPseudoStateAxisKey = (rawKey) => PSEUDO_STATE_AXIS_KEYS.has(sanitizePropKeyForMatch(rawKey));
const PSEUDO_STATE_BOOLEAN_TOKENS = ['hover', 'focus', 'active', 'pressed', 'selected', 'current'];
const isPseudoStateBooleanKey = (rawKey) => {
  const sanitized = sanitizePropKeyForMatch(rawKey);
  return PSEUDO_STATE_BOOLEAN_TOKENS.some((token) => sanitized.includes(token));
};

const dropPseudoStateProps = (schema, propHints, hasConfidentSurface, figmaVariantProperties = null) => {
  if (!hasConfidentSurface) return schema;
  if (!schema || schema.status !== 'built') return schema;
  const props = Array.isArray(schema.props) ? schema.props : [];
  if (props.length === 0) return schema;

  const variantKeys = figmaVariantProperties && typeof figmaVariantProperties === 'object'
    ? Object.keys(figmaVariantProperties).map(sanitizePropKeyForMatch)
    : [];
  const hasVariantAxis = (figmaKey) => {
    const key = sanitizePropKeyForMatch(figmaKey);
    if (!key) return false;
    if (!isPseudoStateAxisKey(key)) return false;
    return variantKeys.includes(key);
  };

  const allow = (prop) => propHints && propHints.has(prop?.name);
  const filtered = props.filter((prop) => {
    if (!prop) return false;
    if (allow(prop)) return true;
    const figmaKey = prop.figmaKey || prop.name || '';
    const variantHasPseudo = hasVariantAxis(figmaKey);
    if (prop.kind === 'enum' && isPseudoStateAxisKey(figmaKey)) {
      return variantHasPseudo;
    }
    if (prop.kind === 'boolean' && isPseudoStateAxisKey(figmaKey)) {
      if (variantHasPseudo) return false;
      if (String(figmaKey).trim().startsWith('.') && isPseudoStateBooleanKey(figmaKey)) return false;
      return false;
    }
    if (prop.kind === 'boolean' && String(figmaKey).trim().startsWith('.') && isPseudoStateBooleanKey(figmaKey)) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) return schema;

  const filteredNames = new Set(filtered.map((p) => p.name).filter(Boolean));
  const exampleProps = schema.exampleProps && typeof schema.exampleProps === 'object' ? schema.exampleProps : {};
  const filteredExampleProps = Object.entries(exampleProps).reduce((acc, [key, value]) => {
    if (filteredNames.has(key)) acc[key] = value;
    return acc;
  }, {});

  return { ...schema, props: filtered, exampleProps: filteredExampleProps };
};

const buildPropSurfaceForAgent = (propHints, componentJson) => {
  if (!propHints || propHints.size === 0) return null;
  const rawHints = Array.from(propHints).filter(Boolean);
  const hasNonChildren = rawHints.some((p) => p !== 'children');
  if (!hasNonChildren) return null;

  const sanitizedHints = rawHints.map(sanitizePropKeyForMatch).filter(Boolean);
  if (sanitizedHints.length >= 5) {
    return { validProps: rawHints.sort() };
  }

  const variantProps =
    componentJson?.data?.variantProperties ||
    componentJson?.variantProperties ||
    {};
  const variantKeys = Object.keys(variantProps).map(sanitizePropKeyForMatch).filter(Boolean);
  const hasOverlap = sanitizedHints.some((h) => variantKeys.includes(h));
  if (!hasOverlap) return null;

  return { validProps: rawHints.sort() };
};

const applyPropHintsToSchema = (schema, propNames, figmaVariantProperties = null) => {
  if (!schema || schema.status !== 'built') return schema;
  if (!propNames || propNames.size === 0) return schema;

  const variantKeys =
    figmaVariantProperties && typeof figmaVariantProperties === 'object'
      ? new Set(Object.keys(figmaVariantProperties || {}).map(sanitizePropKeyForMatch))
      : null;
  const allow = (prop) => {
    const name = prop?.name;
    if (!name) return false;
    if (propNames.has(name) || name === 'children') return true;
    if (variantKeys && prop?.figmaKey && variantKeys.has(sanitizePropKeyForMatch(prop.figmaKey))) {
      return true;
    }
    return false;
  };
  const filteredProps = Array.isArray(schema.props) ? schema.props.filter((p) => allow(p)) : [];
  if (filteredProps.length === 0) return schema;

  const exampleProps = schema.exampleProps && typeof schema.exampleProps === 'object' ? schema.exampleProps : {};
  const filteredExampleProps = Object.entries(exampleProps).reduce((acc, [key, value]) => {
    if (propNames.has(key) || key === 'children') acc[key] = value;
    // Keep example for allowed variant-derived props if present.
    if (!acc[key] && variantKeys && variantKeys.has(sanitizePropKeyForMatch(key))) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return { ...schema, props: filteredProps, exampleProps: filteredExampleProps };
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

const buildAgentPayload = (
  promptText,
  componentMeta,
  componentJson,
  orienterEntry,
  files,
  figmaInfo,
  targetFramework,
  angularComponents = [],
  propSurface = null
) => {
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

  const lines = [
    promptText.trim(),
    '',
    `# Target framework: ${targetFramework || 'react'}`,
    '',
    '# Your Inputs (included below)',
    '',
    '## Figma component metadata',
    JSON.stringify(figmaBlock, null, 2),
    '',
    '## Orientation',
    JSON.stringify(orienterEntry, null, 2),
    ''
  ];

  if (propSurface && Array.isArray(propSurface.validProps) && propSurface.validProps.length > 0) {
    lines.push('## Component API surface (authoritative)');
    lines.push(JSON.stringify(propSurface, null, 2));
    lines.push('');
  }

  if ((targetFramework || 'react') === 'angular') {
    lines.push('## Angular components (from repo summary)');
    lines.push(JSON.stringify(angularComponents, null, 2));
    lines.push('');
  }

  lines.push('## Contents of selected files');
  lines.push(serializedFiles);
  lines.push('');

  return lines.join('\n');
};

const renderTsxFromSchema = (
  schema,
  figmaVariantProperties = null,
  figmaComponentProperties = null,
  tokenName = null,
  options = {}
) => {
  const lines = [];
  lines.push("import figma from '@figma/code-connect/react';");
  const allowImplicitText = options.allowImplicitText !== undefined ? options.allowImplicitText : true;
  const canonicalizeAxisName = (rawAxis) => {
    const normalized = sanitizeJsName(normalizeFigmaKey(rawAxis)) || 'prop';
    const lowerFirst = normalized ? normalized[0].toLowerCase() + normalized.slice(1) : normalized;
    const sanitized = sanitizePropKeyForMatch(lowerFirst);
    if (sanitized === 'colorpallete' || sanitized === 'color_pallete') return 'colorPalette';
    return lowerFirst;
  };

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
  const isValidIdentifier = (name) => /^[A-Za-z_$][\w$]*$/.test(name);

  const baseProps = Array.isArray(schema.props) ? schema.props : [];
  const normalizedComponentProps = Array.isArray(figmaComponentProperties) ? figmaComponentProperties : [];
  const normalizedVariantProps =
    figmaVariantProperties && typeof figmaVariantProperties === 'object' ? figmaVariantProperties : {};

  const normalizeKeyForMatch = (key) => normalizeFigmaKey(key).replace(/^[.]/, '').replace(/[?]$/, '');
  const basePropsByKey = new Map(
    baseProps
      .filter((p) => p && typeof p === 'object' && p.figmaKey)
      .map((p) => [normalizeKeyForMatch(p.figmaKey), p])
      .filter(([key]) => key)
  );

  const deriveVariantProps = () =>
    Object.entries(normalizedVariantProps)
      .map(([name, values]) => {
        if ((name || '').trim().startsWith('.')) return null;
        const figmaKey = name || '';
        const normalizedName = canonicalizeAxisName(name);
        const enumValues = Array.isArray(values) ? values : Object.keys(values || {});
        const valueMapping = enumValues.reduce((acc, v) => {
          acc[v] = v;
          return acc;
        }, {});
        return { name: normalizedName, figmaKey, kind: 'enum', values: enumValues, valueMapping };
      })
      .filter(Boolean);

  const schemaStringPropsByKey = new Map(
    baseProps
      .filter((p) => p && typeof p === 'object' && p.kind === 'string')
      .map((p) => [normalizeFigmaKey(p.figmaKey || p.name || ''), p])
      .filter(([key]) => key)
  );

  const textKeys = new Set(['label', 'text', 'children', 'content', 'title']);

  const deriveComponentProps = () =>
    normalizedComponentProps
      .map((cp) => {
        const rawName = cp?.name || '';
        if (!rawName) return null;
        if (rawName.trim().startsWith('.')) return null;
        const normalizedKey = normalizeFigmaKey(rawName);
        const jsBase = sanitizeJsName(normalizedKey) || 'prop';
        const lowerBase = jsBase.toLowerCase();

        if (cp?.type === 'STRING') {
          const schemaMatch = schemaStringPropsByKey.get(normalizedKey) || null;
          const allowAsText = allowImplicitText && textKeys.has(lowerBase);
          if (!schemaMatch && !allowAsText) return null;
          const name = schemaMatch?.name || (allowAsText ? 'children' : jsBase);
          const schemaExample = schema.exampleProps && typeof schema.exampleProps === 'object' ? schema.exampleProps[name] : undefined;
          const defaultValue =
            schemaExample !== undefined
              ? schemaExample
              : schemaMatch?.defaultValue !== undefined
                ? schemaMatch.defaultValue
                : schema.figmaComponentName || schema.reactComponentName || 'Label';
          return { name, figmaKey: rawName, kind: 'string', defaultValue };
        }

        const isOptionalFlag = rawName.trim().endsWith('?');
        const name = isOptionalFlag ? `${jsBase}Enabled` : jsBase;
        const kind =
          cp?.type === 'BOOLEAN'
            ? 'boolean'
            : cp?.type === 'INSTANCE_SWAP'
              ? 'instance'
              : cp?.type === 'NUMBER'
                ? 'string'
                : 'string';
        return { name, figmaKey: rawName, kind };
      })
      .filter(Boolean);

  const derivedVariantProps = deriveVariantProps();
  const derivedComponentProps = deriveComponentProps();
  const shouldUseFigmaProps = derivedVariantProps.length > 0 || derivedComponentProps.length > 0;

  const seenPropNames = new Set();

  const allowTextProp = (prop) => {
    if (!prop || prop.kind !== 'string') return false;
    const key = normalizeKeyForMatch(prop.figmaKey || prop.name);
    return prop.name === 'children' || textKeys.has(key.toLowerCase());
  };

  const applySchemaHintsToDerived = (derived) => {
    if (basePropsByKey.size === 0) return derived;
    return derived.map((prop) => {
      if (!prop) return prop;
      const key = normalizeKeyForMatch(prop.figmaKey || prop.name);
      const base = basePropsByKey.get(key);
      if (!base) return prop;
      if (base.kind && base.kind !== prop.kind) return prop;
      if (base.name && base.name !== prop.name) return { ...prop, name: base.name };
      return prop;
    });
  };

  const derivedProps = shouldUseFigmaProps
    ? applySchemaHintsToDerived([...derivedVariantProps, ...derivedComponentProps])
    : [];
  // Preserve agent/schema props (for text, loading, etc.) and append Figma-derived props for new axes.
  const combinedProps = shouldUseFigmaProps ? [...baseProps, ...derivedProps] : baseProps;

  const sourceProps = combinedProps.filter((p) => {
    const name = p?.name || '';
    if (!name) return false;
    if (seenPropNames.has(name)) return false;
    seenPropNames.add(name);
    return true;
  });

  const propEntries = sourceProps.map((p) => {
    const figmaKeyRaw = p && typeof p === 'object' ? p.figmaKey || p.name || null : null;
    const figmaKey = normalizeFigmaKey(figmaKeyRaw);
    return { ...p, figmaKey };
  });
  const variantKeySet = new Set(Object.keys(normalizedVariantProps).map(normalizeFigmaKey));
  const componentPropKeySet = new Set(
    normalizedComponentProps.map((p) => normalizeFigmaKey(p?.name)).filter(Boolean)
  );
  const allowedKeys = new Set([...variantKeySet, ...componentPropKeySet]);
  const hasExplicitFigmaProps = figmaVariantProperties !== null || figmaComponentProperties !== null;
  const hasFigmaInfo = hasExplicitFigmaProps || allowedKeys.size > 0 || shouldUseFigmaProps;

  const filterByAllowedKeys = (entries) => {
    return entries.filter((p) => {
      const key = normalizeFigmaKey(p?.figmaKey);
      if (!key) return true;
      if (allowedKeys.size > 0) return allowedKeys.has(key);
      if (key.startsWith('.') && hasFigmaInfo) return false;
      return true;
    });
  };

  const filteredPropsRaw = filterByAllowedKeys(propEntries);

  const assignVarNames = (props) => {
    const used = new Set();
    return props.map((p) => {
      const base = isValidIdentifier(p.name) ? p.name : sanitizeJsName(p.name) || 'prop';
      let varName = base || 'prop';
      let counter = 1;
      while (used.has(varName)) {
        varName = `${base}_${counter++}`;
      }
      used.add(varName);
      return { ...p, varName };
    });
  };

  const filteredProps = assignVarNames(filteredPropsRaw);
  const renderProp = (prop) => {
    const propKey = isValidIdentifier(prop.name) ? prop.name : `'${prop.name}'`;
    if (prop.kind === 'enum') {
      const mapping = prop.valueMapping || {};
      const entries = Object.entries(mapping)
        .map(([k, v]) => `'${k}': '${v}'`)
        .join(', ');
      return `${propKey}: figma.enum('${prop.figmaKey}', { ${entries} })`;
    }
    if (prop.kind === 'boolean') return `${propKey}: figma.boolean('${prop.figmaKey}')`;
    if (prop.kind === 'string') return `${propKey}: figma.string('${prop.figmaKey}')`;
    if (prop.kind === 'instance') return `${propKey}: figma.instance('${prop.figmaKey}')`;
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
    const rawLiteral = hasLiteral ? exampleProps[prop.name] : prop.defaultValue;
    const literal =
      prop.kind === 'enum' && rawLiteral !== undefined
        ? (() => {
            const values = Array.isArray(prop.values) ? prop.values : [];
            if (values.length === 0) return rawLiteral;
            if (values.includes(rawLiteral)) return rawLiteral;
            if (typeof rawLiteral === 'string') {
              const match = values.find((v) => String(v).toLowerCase() === rawLiteral.toLowerCase());
              if (match !== undefined) return match;
            }
            return values[0];
          })()
        : rawLiteral;
    const jsLit = toJsLiteral(literal);
    if (isValidIdentifier(prop.name)) {
      return jsLit !== undefined ? `${prop.varName} = ${jsLit}` : prop.varName;
    }
    const alias = jsLit !== undefined ? `${prop.varName} = ${jsLit}` : prop.varName;
    return `'${prop.name}': ${alias}`;
  };

  const destructuredParams = filteredProps.map(buildDestructured).join(', ');

  const normalizedKey = (key) => (key || '').replace(/^[.]/, '').replace(/[?]$/, '');
  const booleanByKey = new Map(
    filteredProps
      .filter((p) => p.kind === 'boolean' && p.figmaKey)
      .map((p) => [normalizedKey(p.figmaKey), p.varName])
  );
  const booleanByName = new Map(filteredProps.filter((p) => p.kind === 'boolean').map((p) => [p.varName, p.varName]));
  const inlineInstanceNames = new Set(['iconStart', 'iconEnd']);
  const inlineInstanceSegments = [];
  const instanceNames = new Set(filteredProps.filter((p) => p.kind === 'instance').map((p) => p.varName));

  const buildExampleAttr = (prop) => {
    const attrName = prop.name;
    const valueName = prop.varName;
    if (!attrName) return null;

    if (attrName === 'children') return null;

    // Gate instance props if a related boolean exists.
    if (prop.kind === 'instance') {
      const key = normalizedKey(prop.figmaKey || prop.name);
      const gateName =
        booleanByKey.get(key) ||
        booleanByName.get(`${valueName}Enabled`) ||
        booleanByName.get(`${key}Enabled`) ||
        booleanByName.get(key) ||
        null;

      if (inlineInstanceNames.has(attrName)) {
        const segment = gateName ? `{${gateName} ? ${valueName} : null}` : `{${valueName}}`;
        inlineInstanceSegments.push({ name: attrName, segment });
        return null;
      }

      if (gateName) {
        return `${attrName}={${gateName} ? ${valueName} : undefined}`;
      }
      return `${attrName}={${valueName}}`;
    }

    if (prop.kind === 'boolean') {
      const base = valueName.endsWith('Enabled') ? valueName.slice(0, -'Enabled'.length) : null;
      if (base && (instanceNames.has(base) || inlineInstanceNames.has(base))) {
        return null;
      }
      return `${attrName}={${valueName}}`;
    }

    return `${attrName}={${valueName}}`;
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

  const exampleHeader = destructuredParams.trim()
    ? `  example: ({ ${destructuredParams} } = {}) => (`
    : '  example: () => (';
  lines.push(exampleHeader);
  lines.push(`    <${schema.reactComponentName}${exampleAttrs}>${childExpr}</${schema.reactComponentName}>`);
  lines.push('  ),');
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
    .option('--repo-summary <file>', 'Path to repo-summary.json', null)
    .option('--force', 'Overwrite existing *.figma.tsx files', false)
    .option('--agent-backend <value>', 'Agent backend (openai|claude)', 'claude')
    .option('--agent-model <value>', 'Agent model for SDK backends')
    .option('--agent-max-tokens <value>', 'Max output tokens for agent responses')
    .option('--only <list...>', 'Component names/IDs (globs allowed); accepts comma or space separated values')
    .option('--exclude <list...>', 'Component names/IDs to skip (globs allowed)')
    .option('--target-framework <value>', 'Target framework hint (react|angular)')
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();
  const parseList = (values) => {
    const raw = Array.isArray(values) ? values : values ? [values] : [];
    return raw
      .flatMap((item) => String(item).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const figmaIndexPath = path.resolve(opts.figmaIndex);
  const superconnectDir = path.dirname(figmaIndexPath);
  const repoRoot = path.dirname(superconnectDir);
  return {
    repo: repoRoot,
    figmaDir: path.join(superconnectDir, 'figma-components'),
    figmaIndex: figmaIndexPath,
    orienter: path.resolve(opts.orienter),
    repoSummary: opts.repoSummary ? path.resolve(opts.repoSummary) : path.join(superconnectDir, 'repo-summary.json'),
    codeConnectDir: DEFAULT_CODECONNECT_DIR,
    logDir: path.join(superconnectDir, 'codegen-logs'),
    agentLogDir: path.join(superconnectDir, 'mapping-agent-logs'),
    force: Boolean(opts.force),
    agentBackend: (opts.agentBackend || 'claude').toLowerCase(),
    agentModel: opts.agentModel || undefined,
    agentMaxTokens: parseInt(opts.agentMaxTokens, 10) || undefined,
    only: parseList(opts.only),
    exclude: parseList(opts.exclude),
    targetFramework: opts.targetFramework || null
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

const extractRequiredPaths = (normalized) => {
  if (!Array.isArray(normalized.files)) return [];
  return normalized.files.map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean);
};

const resolveComponentIdentity = (normalized, figmaIndex) => {
  const componentMeta = findComponentMeta(figmaIndex, normalized) || {};
  const orienterName =
    normalized.figmaComponentName || normalized.canonicalName || normalized.figmaComponentId || 'component';
  const logBaseName = componentMeta.name || componentMeta.id || orienterName || 'component';
  const componentKey =
    componentMeta.id ||
    normalized.figmaComponentId ||
    (componentMeta.name ? componentMeta.name.toLowerCase() : orienterName ? orienterName.toLowerCase() : null);
  return { componentMeta, orienterName, logBaseName, componentKey };
};

const getComponentJson = (componentKey, figmaComponents) =>
  componentKey ? figmaComponents[componentKey] || null : null;

const markSeenOrSkip = (normalized, seen) => {
  const key = normalized.figmaComponentId || (normalized.figmaComponentName || '').toLowerCase();
  if (!key) return false;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
};

const buildFigmaInfoBlock = (figmaIndex, componentMeta) => ({
  file: {
    key: figmaIndex.fileKey || null,
    name: figmaIndex.fileName || null
  },
  nodeUrl: buildFigmaNodeUrl(figmaIndex.fileKey, figmaIndex.fileName, componentMeta.id || null)
});

const findAngularMatch = (angularComponents, orienterFile) =>
  (angularComponents || []).find((c) => c.ts_file === orienterFile) ||
  (angularComponents || []).find((c) => path.normalize(c.ts_file || '') === path.normalize(orienterFile || ''));


async function main() {
  const config = parseArgs(process.argv);
  if (config.force) {
    [config.logDir, config.agentLogDir].forEach((dir) => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const [figmaIndex, figmaComponents, repoSummary] = await Promise.all([
    readJsonSafe(config.figmaIndex),
    loadFigmaComponents(config.figmaDir),
    readJsonSafe(config.repoSummary)
  ]);

  if (!figmaIndex?.components) {
    console.error(`❌ Could not read figma index: ${config.figmaIndex}`);
    process.exit(1);
  }

  if (config.targetFramework) {
    console.log(`${highlight('Target framework')}: ${config.targetFramework}`);
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
    codeConnectDir: config.codeConnectDir,
    logDir: config.logDir,
    agentLogDir: config.agentLogDir,
    force: config.force,
    angularComponents: Array.isArray(repoSummary?.angular_components) ? repoSummary.angular_components : [],
    targetFramework: config.targetFramework || null,
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

    const normalized = normalizeOrienterRecord(orienterEntry);
    if (normalized.status !== 'mapped') continue;
    if (markSeenOrSkip(normalized, ctx.seen)) continue;

    const { componentMeta, orienterName, logBaseName, componentKey } = resolveComponentIdentity(
      normalized,
      ctx.figmaIndex
    );

    const componentJson = getComponentJson(componentKey, ctx.figmaComponents);
    const requiredPaths = extractRequiredPaths(normalized);
    const files = await readRequestedFiles(ctx.repo, requiredPaths);
    const figmaUrl = buildFigmaNodeUrl(
      ctx.figmaIndex.fileKey,
      ctx.figmaIndex.fileName || componentMeta.name,
      componentMeta.id || normalized.figmaComponentId
    );

    if (!figmaUrl) {
      console.warn(`⚠️  Could not build Figma URL for ${logBaseName} - missing fileKey or component ID`);
      const logEntry = {
        figmaName: componentMeta.name,
        figmaId: componentMeta.id,
        status: 'error',
        reason: 'Could not build Figma URL - missing fileKey or component ID'
      };
      await writeLog(ctx.logDir, logBaseName, logEntry);
      ctx.summaries.push(logEntry);
      continue;
    }

    // Build figma evidence for direct codegen
    const figmaEvidence = {
      componentName: componentMeta.name || normalized.figmaComponentName,
      variantProperties: componentJson?.data?.variantProperties || componentJson?.variantProperties || {},
      componentProperties: componentJson?.data?.componentProperties || componentJson?.componentProperties || [],
      textLayers: componentJson?.data?.textLayers || [],
      slotLayers: componentJson?.data?.slotLayers || []
    };

    // Build orientation data
    const orientation = {
      canonicalName: normalized.canonicalName || componentMeta.name,
      importPath: normalized.importPath,
      files: requiredPaths
    };

    // Add Angular-specific data if needed
    if (config.targetFramework === 'angular' && requiredPaths.length > 0) {
      const angularMatch = findAngularMatch(ctx.angularComponents, requiredPaths[0]);
      if (angularMatch) {
        orientation.selector = angularMatch.selector;
        orientation.inputs = angularMatch.inputs || [];
      }
    }

    // Build source context from files
    const sourceContext = {};
    files.forEach((f) => {
      if (!f.error && f.content) {
        sourceContext[f.path] = f.content;
      }
    });

    console.log(`Generating Code Connect for ${generatedColor(logBaseName)}`);

    try {
      // Call the appropriate direct codegen processor
      const processComponent = config.targetFramework === 'angular' 
        ? processAngularComponent 
        : processReactComponent;

      const result = await processComponent({
        agent: ctx.agent,
        figmaEvidence,
        orientation,
        figmaUrl,
        sourceContext,
        maxRetries: 2,
        maxTokens: config.agentMaxTokens || 4096
      });

      if (result.success && result.code) {
        // Determine file extension
        const ext = config.targetFramework === 'angular' ? '.figma.ts' : '.figma.tsx';
        const fileName = `${sanitizeSlug(componentMeta.name || normalized.figmaComponentName || 'component')}${ext}`;
        
        // Write the code connect file
        const targetPath = path.join(ctx.repo, ctx.codeConnectDir, fileName);
        const exists = fs.existsSync(targetPath);
        
        if (exists && !ctx.force) {
          const logEntry = {
            figmaName: componentMeta.name,
            figmaId: componentMeta.id,
            status: 'skipped',
            reason: 'Existing Code Connect file present (rerun with --force to overwrite)',
            codeConnectFile: path.relative(ctx.repo, targetPath)
          };
          await writeLog(ctx.logDir, logBaseName, logEntry);
          ctx.summaries.push(logEntry);
          continue;
        }

        // Ensure directory exists and write file
        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeFile(targetPath, result.code, 'utf8');

        const logEntry = {
          figmaName: componentMeta.name,
          figmaId: componentMeta.id,
          status: 'built',
          reason: 'Generated via direct codegen',
          codeConnectFile: path.relative(ctx.repo, targetPath),
          overwritten: exists,
          attempts: result.attempts || []
        };
        await writeLog(ctx.logDir, logBaseName, logEntry);
        ctx.summaries.push(logEntry);
      } else {
        // Generation failed
        const logEntry = {
          figmaName: componentMeta.name,
          figmaId: componentMeta.id,
          status: 'error',
          reason: result.errors.length > 0 
            ? `Generation failed: ${result.errors[0]}` 
            : 'Generation failed after max retries',
          attempts: result.attempts || []
        };
        await writeLog(ctx.logDir, logBaseName, logEntry);
        ctx.summaries.push(logEntry);
      }
    } catch (err) {
      console.error(`Error processing ${logBaseName}: ${err.message}`);
      const logEntry = {
        figmaName: componentMeta.name,
        figmaId: componentMeta.id,
        status: 'error',
        reason: `Exception: ${err.message}`
      };
      await writeLog(ctx.logDir, logBaseName, logEntry);
      ctx.summaries.push(logEntry);
    }
  }

  const built = ctx.summaries.filter((s) => s.status === 'built');
  const skipped = ctx.summaries.filter((s) => s.status !== 'built');
  console.log(`Done. Built ${built.length}, skipped ${skipped.length}. Logs → ${config.logDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
