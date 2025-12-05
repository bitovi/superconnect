#!/usr/bin/env node

/**
 * Figma Component Variants Extractor (JSON-only)
 *
 * Downloads all variants from a Figma file and saves them as JSON plus an index.
 *
 * Usage:
 *   node scripts/figma-scan.js <fileKeyOrUrl> [options]
 *
 * Options:
 *   --token       Figma API token (or set FIGMA_ACCESS_TOKEN env variable)
 *   --output      Output directory
 *   --index       Index output path (figma-components-index.json)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetch } = require('undici');
const { Command } = require('commander');
const chalk = require('chalk').default;
const stringifyCompact = require('json-stringify-pretty-compact').default;
const { figmaColor } = require('./colors');

const SCHEMA_VERSION = 'figma-component@1';
const INDEX_SCHEMA_VERSION = 'figma-component-index@1';

function parseFileKey(input) {
  if (!input) return '';
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return urlMatch ? urlMatch[1] : input;
}

function parseArgs() {
  const program = new Command();
  program
    .argument('<fileKeyOrUrl>', 'Figma file key or URL')
    .option('--token <token>', 'Figma API token (or set FIGMA_ACCESS_TOKEN)')
    .option('--output <dir>', 'Output directory', './figma-variants')
    .option('--index <file>', 'Canonical index output path (figma-components-index.json)');
  program.parse(process.argv);
  const opts = program.opts();
  return {
    fileKey: parseFileKey(program.args[0]),
    token: opts.token || process.env.FIGMA_ACCESS_TOKEN,
    output: opts.output,
    indexPath: opts.index || null
  };
}

async function figmaRequest(pathname, token) {
  const res = await fetch(`https://api.figma.com${pathname}`, {
    method: 'GET',
    headers: { 'X-Figma-Token': token }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} - ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Figma API returned malformed JSON: ${err.message}`);
  }
}

function findComponentSets(node, acc = [], breadcrumbs = []) {
  if (!node) return acc;
  const nextTrail = node.name ? [...breadcrumbs, node.name] : breadcrumbs;
  if (node.type === 'COMPONENT_SET') {
    acc.push({ node, breadcrumbs: nextTrail });
  }
  if (node.children) {
    node.children.forEach((child) => findComponentSets(child, acc, nextTrail));
  }
  return acc;
}

const toCamelCase = (value) => {
  const safe = (value || '').trim().toLowerCase();
  if (!safe) return '';
  const parts = safe.split(/[\s_-]+/).filter(Boolean);
  return parts
    .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
};

const normalizeVariantKey = (raw) => toCamelCase(raw);

const normalizeVariantValue = (raw) => (raw || '').trim().replace(/\s+/g, ' ');

const toEnumValue = (raw) => normalizeVariantValue(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const addOption = (options, normalizedKey, rawKey, normalizedValue, enumValue) => {
  const next =
    options[normalizedKey] || { rawKeys: new Set(), values: new Set(), enums: new Set(), firstRawKey: null };
  next.rawKeys.add(rawKey);
  next.values.add(normalizedValue);
  next.enums.add(enumValue);
  if (!next.firstRawKey) {
    next.firstRawKey = rawKey;
  }
  options[normalizedKey] = next;
  return options;
};

const parseVariantProperties = (variantName, options) => {
  const properties = {};
  const rawProperties = {};
  if (!variantName) return { properties, rawProperties };
  const propertyPairs = variantName.split(',').map((p) => p.trim());
  for (const pair of propertyPairs) {
    const [rawKey, rawValue] = pair.split('=').map((s) => s.trim());
    if (!rawKey || !rawValue) continue;
    const normalizedKey = normalizeVariantKey(rawKey);
    const normalizedValue = normalizeVariantValue(rawValue);
    const enumValue = toEnumValue(rawValue);
    properties[normalizedKey] = normalizedValue;
    rawProperties[rawKey] = rawValue;
    addOption(options, normalizedKey, rawKey, normalizedValue, enumValue);
  }
  return { properties, rawProperties };
};

const isHiddenComponent = (name) => {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const first = trimmed.charAt(0);
  if (first === '.' || first === '_') return true;
  // Treat names that sanitize to a single underscore (punctuation-only) as hidden noise.
  const sanitized = sanitizeFilename(trimmed);
  return sanitized === '_';
};

const toSortedArray = (input) => Array.from(input || []).sort((a, b) => a.localeCompare(b));

const stableStringify = (value) => {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildAliases = (name) => {
  const canonical = (name || '').trim();
  const slashParts = canonical.split('/').map((p) => p.trim()).filter(Boolean);
  const base = slashParts[slashParts.length - 1] || canonical;
  const withoutParens = base.replace(/\s*\(.*?\)\s*$/, '').trim();
  const trimmedSuffix = withoutParens.replace(/\b(component|components|default|base|new)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const alias = trimmedSuffix || withoutParens || base || canonical;
  const candidates = Array.from(new Set([canonical, base, withoutParens, alias])).filter(Boolean);
  return { canonical, alias, candidates };
};

const buildBreadcrumbs = (breadcrumbs = []) => {
  return {
    fullPath: breadcrumbs,
    path: breadcrumbs.join(' / ')
  };
};

const computeChecksum = (payload) => {
  const stable = stableStringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
};

function extractVariants(componentSet, breadcrumbs) {
  const variants = [];
  const propertyOptions = {};
  const seenVariantIds = new Set();

  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type !== 'COMPONENT') continue;
      if (seenVariantIds.has(variant.id)) continue;
      seenVariantIds.add(variant.id);
      const { properties, rawProperties } = parseVariantProperties(variant.name, propertyOptions);
      const entry = {
        variantId: variant.id,
        name: variant.name,
        properties,
        rawProperties
      };
      const desc = (variant.description || '').trim();
      if (desc) entry.description = desc;
      if (variant.key) entry.key = variant.key;
      variants.push(entry);
    }
  }

  const variantValueEnums = {};
  const variantProperties = {};
  Object.keys(propertyOptions)
    .sort()
    .forEach((normalizedKey) => {
      const meta = propertyOptions[normalizedKey];
      const values = toSortedArray(meta.values);
      const rawKey = meta.firstRawKey || normalizedKey;
      variantValueEnums[rawKey] = {
        normalizedKey,
        rawKeys: toSortedArray(meta.rawKeys),
        values,
        enums: toSortedArray(meta.enums)
      };
      variantProperties[rawKey] = values;
    });

  const basePayload = {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    variantProperties,
    variantValueEnums,
    variants,
    totalVariants: variants.length,
    nameAliases: buildAliases(componentSet.name),
    breadcrumbs: buildBreadcrumbs(breadcrumbs)
  };
  const compDesc = (componentSet.description || '').trim();
  if (compDesc) basePayload.description = compDesc;

  const checksum = computeChecksum(basePayload);

  return {
    schemaVersion: SCHEMA_VERSION,
    checksum: {
      algorithm: 'sha256',
      value: checksum
    },
    ...basePayload
  };
}

function saveJson(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, stringifyCompact(data, { maxLength: 80 }), 'utf8');
  const relativePath = path.relative(process.cwd(), filePath) || filePath;
  const { logMessage } = options;
  if (logMessage !== false) {
    const message = typeof logMessage === 'string' ? logMessage : `\n${chalk.green('✓')} Saved: ${relativePath}`;
    console.log(message);
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
}

async function main() {
  const config = parseArgs();
  if (!config.fileKey) {
    console.error(chalk.red('Error: Figma file key is required'));
    process.exit(1);
  }
  if (!config.token) {
    console.error(chalk.red('Error: Figma API token is required (set FIGMA_ACCESS_TOKEN or use --token)'));
    process.exit(1);
  }

  console.log(chalk.bold('Fetching Figma file...'));
  console.log(`File Key: ${figmaColor(config.fileKey)}`);

  try {
    const fileData = await figmaRequest(`/v1/files/${config.fileKey}`, config.token);
    console.log(`${chalk.green('✓')} Figma file loaded: ${fileData.name}`);
    console.log(`  Version: ${fileData.version}`);
    console.log(`  Last Modified: ${fileData.lastModified}`);

    const pages = fileData.document.children;
    console.log('\nProcessing pages in Figma document:');
    pages.forEach((page) => console.log(`  - ${figmaColor(page.name)}`));

  const allComponentSets = pages.flatMap((page) => findComponentSets(page));
  const visibleSets = allComponentSets.filter(({ node }) => !isHiddenComponent(node.name));
  const variantEntries = [];
  let longestLabel = 0;

    for (const { node: componentSet, breadcrumbs } of visibleSets) {
      const variantData = extractVariants(componentSet, breadcrumbs);
      const label = `${componentSet.name} (${variantData.totalVariants} variants)`;
      longestLabel = Math.max(longestLabel, label.length);
      variantEntries.push({ componentSet, breadcrumbs, variantData });
    }

    console.log(`\n${chalk.green('✓')} Found ${variantEntries.length} Figma component sets`);

    let processedCount = 0;
    const componentsMeta = [];
    const usedFilenames = new Set();

    for (const entry of variantEntries) {
      const { componentSet, variantData } = entry;
      const baseName = sanitizeFilename(componentSet.name) || 'component';
      let filename = baseName;
      let suffix = 1;
      while (usedFilenames.has(filename)) {
        filename = `${baseName}_${suffix}`;
        suffix += 1;
      }
      usedFilenames.add(filename);

    const jsonPath = path.join(config.output, `${filename}.json`);
    saveJson(jsonPath, variantData, { logMessage: false });
    const relativePath = path.relative(process.cwd(), jsonPath) || jsonPath;
    const label = `${componentSet.name} (${variantData.totalVariants} variants)`.padEnd(longestLabel + 1);
    console.log(`${figmaColor(label)}→ ${figmaColor(relativePath)}`);

      const componentName = variantData.componentName;
      const meta = {
        name: variantData.componentName,
        id: variantData.componentSetId,
        variantCount: variantData.totalVariants,
        checksum: variantData.checksum?.value || null,
        schemaVersion: variantData.schemaVersion
      };
      if (variantData.description) meta.description = variantData.description;
      const alias = variantData.nameAliases?.alias || '';
      const aliasCandidates = Array.isArray(variantData.nameAliases?.candidates)
        ? variantData.nameAliases.candidates.filter((a) => a && a !== componentName)
        : [];
      if (alias && alias !== componentName) meta.alias = alias;
      if (aliasCandidates.length) meta.aliases = aliasCandidates;
      const pathStr = variantData.breadcrumbs?.path || '';
      if (pathStr) meta.breadcrumbPath = pathStr;
      componentsMeta.push(meta);
      processedCount++;
    }

    // Write the canonical pipeline index: figma-components-index.json at repo root or provided path.
    const indexData = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      fileName: fileData.name,
      fileKey: config.fileKey,
      fileUrl: fileData?.document?.id
        ? `https://www.figma.com/design/${config.fileKey}`
        : `https://www.figma.com/file/${config.fileKey}`,
      version: fileData.version,
      lastModified: fileData.lastModified,
      exportDate: new Date().toISOString(),
      components:
        componentsMeta.length > 0
          ? componentsMeta
          : allComponentSets
              .filter(({ node }) => !isHiddenComponent(node.name))
              .map(({ node }) => {
                const entry = {
                  name: node.name,
                  id: node.id,
                  variantCount: node.children ? node.children.length : 0
                };
                const desc = (node.description || '').trim();
                if (desc) entry.description = desc;
                return entry;
              })
    };
    const indexPath = config.indexPath
      ? path.resolve(config.indexPath)
      : path.join(path.dirname(path.resolve(config.output)), 'figma-components-index.json');
    saveJson(indexPath, indexData);

    console.log(`\n${chalk.green('✓')} Complete! Processed ${processedCount} component(s)`);
  } catch (error) {
    console.error(`\n${chalk.red('❌ Error:')} ${error.message}`);
    process.exit(1);
  }
}

main();
