#!/usr/bin/env node
// @ts-nocheck

/**
 * Figma Component Variants Extractor (JSON-only)
 *
 * Downloads all variants from a Figma file and saves them as JSON plus an index.
 *
 * Usage:
 *   npx tsx scripts/figma-scan.ts <fileKeyOrUrl> [options]
 *
 * Options:
 *   --token       Figma API token (or set FIGMA_ACCESS_TOKEN env variable)
 *   --output      Output directory
 *   --index       Index output path (figma-components-index.json)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
// Use Node's native fetch (Node 22+) instead of undici for better Windows compatibility
import { Command } from 'commander';
import chalk from 'chalk';
import { figmaColor } from './colors.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stringifyCompact = (value: any) => {
  // Lazy-load ESM helper to keep formatting compact.
  // This keeps behavior identical to json-stringify-pretty-compact without forcing ESM import at module load.
  return import('json-stringify-pretty-compact').then((pkg) => {
    const fn = (pkg as any).default || pkg;
    return fn(value);
  });
};

const SCHEMA_VERSION = 'figma-component@1';
const INDEX_SCHEMA_VERSION = 'figma-component-index@1';

function parseFileKey(input: any): string {
  if (!input) return '';
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]{10,})/);
  return urlMatch ? urlMatch[1] : input;
}

const DEFAULT_LAYER_DEPTH = 3;

function parseArgs(): any {
  const program = new Command();
  program
    .argument('<fileKeyOrUrl>', 'Figma file key or URL')
    .option('--token <token>', 'Figma API token (or set FIGMA_ACCESS_TOKEN)')
    .option('--output <dir>', 'Output directory', './figma-variants')
    .option('--index <file>', 'Canonical index output path (figma-components-index.json)')
    .option('--layer-depth <depth>', 'Max depth for layer tree traversal (default 3)', DEFAULT_LAYER_DEPTH.toString());
  program.parse(process.argv);
  const opts = program.opts();
  const layerDepth = parseInt(opts.layerDepth, 10);
  return {
    fileKey: parseFileKey(program.args[0]),
    token: opts.token || process.env.FIGMA_ACCESS_TOKEN,
    output: opts.output,
    indexPath: opts.index || null,
    layerDepth: Number.isFinite(layerDepth) && layerDepth > 0 ? layerDepth : DEFAULT_LAYER_DEPTH
  };
}

async function figmaRequest(pathname: string, token: string): Promise<any> {
  let res: any;
  try {
    res = await fetch(`https://api.figma.com${pathname}`, {
      method: 'GET',
      headers: { 'X-Figma-Token': token }
    });
  } catch (err: any) {
    // Enhanced network error handling for corporate environments
    const isNetworkError = err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || 
                           err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
                           err?.message?.includes('fetch failed') || 
                           err?.message?.includes('certificate') || 
                           err?.message?.includes('self-signed') ||
                           err?.message?.includes('SSL') || err?.message?.includes('TLS');
    
    if (isNetworkError) {
      const networkTips = [
        '💡 Network/Certificate Error - Common in corporate environments:',
        '',
        'Quick diagnostics:',
        '  1. Test Figma API: curl -v https://api.figma.com/v1/me -H "X-Figma-Token: YOUR_TOKEN"',
        '  2. Verify you can reach api.figma.com from your network',
        '',
        'Possible solutions:',
        '  • Corporate proxy: Set HTTP_PROXY and HTTPS_PROXY environment variables',
        '  • Certificate issues: Your IT may need to add Figma\'s certs to the trust store',
        '  • Firewall: Ensure api.figma.com (port 443) is allowed',
        '  • VPN: Try connecting/disconnecting from corporate VPN',
        '',
        'As a last resort (INSECURE - only for testing):',
        '  export NODE_TLS_REJECT_UNAUTHORIZED=0',
        '',
        `Raw error: ${err.message}`,
        `Error code: ${err.code || 'none'}`
      ];
      throw new Error(networkTips.join('\n'));
    }
    
    throw new Error(`Network request failed: ${err.message}. Check your internet connection and firewall/proxy settings.`);
  }
  const text = await res.text();
  if (!res.ok) {
    // Enhanced error messages for common Figma API errors
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Figma API authentication failed (${res.status})\n\n` +
        `💡 Troubleshooting:\n` +
        `  - Verify FIGMA_ACCESS_TOKEN is set correctly\n` +
        `  - Get a token from https://www.figma.com/developers/api#access-tokens\n` +
        `  - Ensure token has file_content:read permission\n` +
        `  - Check token hasn't expired\n\n` +
        `Response: ${text}`
      );
    } else if (res.status === 404) {
      throw new Error(
        `Figma file not found (404)\n\n` +
        `💡 Troubleshooting:\n` +
        `  - Verify the file key/URL is correct\n` +
        `  - Ensure you have access to this file\n` +
        `  - Check if file has been deleted or moved\n\n` +
        `Response: ${text}`
      );
    }
    throw new Error(`Figma API error: ${res.status} - ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Figma API returned malformed JSON: ${err.message}`);
  }
}

function findComponentSets(node: any, acc: any[] = [], breadcrumbs: string[] = []): any[] {
  if (!node) return acc;
  const nextTrail = node.name ? [...breadcrumbs, node.name] : breadcrumbs;
  if (node.type === 'COMPONENT_SET') {
    acc.push({ node, breadcrumbs: nextTrail });
  }
  if (node.children) {
    node.children.forEach((child: any) => findComponentSets(child, acc, nextTrail));
  }
  return acc;
}

const toCamelCase = (value: any): string => {
  const safe = (value || '').trim().toLowerCase();
  if (!safe) return '';
  const parts = safe.split(/[\s_-]+/).filter(Boolean);
  return parts
    .map((part: string, idx: number) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
};

const normalizeVariantKey = (raw: any): string => toCamelCase(raw);

const normalizeVariantValue = (raw: any): string => (raw || '').trim().replace(/\s+/g, ' ');

const toEnumValue = (raw: any): string => normalizeVariantValue(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const addOption = (options: any, normalizedKey: string, rawKey: string, normalizedValue: string, enumValue: string): any => {
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

const parseVariantProperties = (variantName: any, options: any): any => {
  const properties: any = {};
  const rawProperties: any = {};
  if (!variantName) return { properties, rawProperties };
  const propertyPairs = variantName.split(',').map((p: string) => p.trim());
  for (const pair of propertyPairs) {
    const [rawKey, rawValue] = pair.split('=').map((s: string) => s.trim());
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

const isHiddenComponent = (name: any): boolean => {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const first = trimmed.charAt(0);
  if (first === '.' || first === '_') return true;
  // Treat names that sanitize to a single underscore (punctuation-only) as hidden noise.
  const sanitized = sanitizeFilename(trimmed);
  return sanitized === '_';
};

const toSortedArray = (input: any): string[] => Array.from(input || []).sort((a: any, b: any) => a.localeCompare(b));

const stableStringify = (value: any): string => {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.map((v: any) => stableStringify(v)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((k: string) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildAliases = (name: any): any => {
  const canonical = (name || '').trim();
  const slashParts = canonical.split('/').map((p: string) => p.trim()).filter(Boolean);
  const base = slashParts[slashParts.length - 1] || canonical;
  const withoutParens = base.replace(/\s*\(.*?\)\s*$/, '').trim();
  const trimmedSuffix = withoutParens.replace(/\b(component|components|default|base|new)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const alias = trimmedSuffix || withoutParens || base || canonical;
  const candidates = Array.from(new Set([canonical, base, withoutParens, alias])).filter(Boolean);
  return { canonical, alias, candidates };
};

const buildBreadcrumbs = (breadcrumbs: string[] = []): any => {
  return {
    fullPath: breadcrumbs,
    path: breadcrumbs.join(' / ')
  };
};

const computeChecksum = (payload: any): string => {
  const stable = stableStringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
};

const inferReferenceType = (name: any, existingType: any = null): string | null => {
  if (existingType) return existingType;
  if (!name) return null;
  const lower = name.toLowerCase();
  if (name.endsWith('?')) return 'BOOLEAN';
  if (lower === 'label' || lower.includes('text')) return 'STRING';
  return 'INSTANCE_SWAP';
};

const normalizeComponentPropertyDefinitions = (defs: any): any[] => {
  if (!defs || typeof defs !== 'object') return [];

  return Object.entries(defs)
    .map(([key, def]: [string, any]) => {
      if (!def || typeof def !== 'object') return null;
      // The key format is "propertyName#nodeId" or just "propertyName"
      // Extract the property name by removing the #nodeId suffix
      const rawName = key.split('#')[0].trim();
      if (!rawName) return null;
      // Skip VARIANT properties - they're handled separately as variantProperties
      if (def.type === 'VARIANT') return null;
      const base: any = {
        name: rawName,
        type: inferReferenceType(rawName, def.type || null)
      };
      if (Object.prototype.hasOwnProperty.call(def, 'defaultValue')) {
        base.defaultValue = def.defaultValue;
      }
      return base;
    })
    .filter(Boolean);
};

const extractComponentProperties = (componentSet: any): any[] | null => {
  if (!componentSet || typeof componentSet !== 'object') return null;

  // Only extract properties defined at the component SET level.
  // Properties defined on individual variants are NOT valid for Code Connect
  // (the SDK validates against the set's componentPropertyDefinitions).
  const fromSet = normalizeComponentPropertyDefinitions(componentSet.componentPropertyDefinitions);
  return fromSet.length > 0 ? fromSet : null;
};

/**
 * Extract text layers from the component tree for figma.textContent() usage.
 * Traverses up to maxDepth levels and collects TEXT nodes.
 * @param node - Figma node to traverse
 * @param maxDepth - Maximum depth to traverse (default 3)
 * @returns Array of text layer objects
 */
const extractTextLayers = (node: any, maxDepth: number = 3): any[] => {
  const textLayers: any[] = [];
  const seenNames = new Set<string>();

  const traverse = (current: any, depth: number): void => {
    if (!current || depth > maxDepth) return;

    if (current.type === 'TEXT') {
      const name = (current.name || '').trim();
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        const layer: any = { name, type: 'TEXT' };
        if (current.characters) {
          layer.characters = current.characters;
        }
        textLayers.push(layer);
      }
    }

    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        traverse(child, depth + 1);
      }
    }
  };

  // Start traversal from each variant (COMPONENT child)
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.type === 'COMPONENT') {
        traverse(child, 0);
      }
    }
  }

  return textLayers;
};

/**
 * Semantic names that suggest a layer is a slot for child components.
 */
const SLOT_NAME_PATTERNS = /^(icon|leading|trailing|prefix|suffix|content|children|slot|container|start|end|left|right)$/i;

/**
 * Extract potential slot layers from the component tree for figma.children() usage.
 * Looks for FRAME/GROUP nodes with semantic names or containing INSTANCE children.
 * @param node - Figma node to traverse
 * @param maxDepth - Maximum depth to traverse (default 3)
 * @returns Array of slot layer objects
 */
const extractSlotLayers = (node: any, maxDepth: number = 3): any[] => {
  const slotLayers: any[] = [];
  const seenNames = new Set<string>();

  const isSlotCandidate = (current: any): boolean => {
    if (current.type !== 'FRAME' && current.type !== 'GROUP') return false;
    const name = (current.name || '').trim();
    if (!name) return false;

    // Check for semantic slot name
    if (SLOT_NAME_PATTERNS.test(name)) return true;

    // Check if contains INSTANCE children (indicates instance swap slot)
    if (Array.isArray(current.children)) {
      const hasInstance = current.children.some((c: any) => c.type === 'INSTANCE');
      if (hasInstance) return true;
    }

    return false;
  };

  const traverse = (current: any, depth: number): void => {
    if (!current || depth > maxDepth) return;

    if (isSlotCandidate(current)) {
      const name = (current.name || '').trim();
      if (!seenNames.has(name)) {
        seenNames.add(name);
        slotLayers.push({ name, type: current.type });
      }
    }

    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        traverse(child, depth + 1);
      }
    }
  };

  // Start traversal from each variant (COMPONENT child)
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.type === 'COMPONENT') {
        traverse(child, 0);
      }
    }
  }

  return slotLayers;
};

function extractVariants(componentSet: any, breadcrumbs: string[], layerDepth: number = DEFAULT_LAYER_DEPTH): any {
  const variants: any[] = [];
  const propertyOptions: any = {};
  const seenVariantIds = new Set<string>();

  if (componentSet.children) {
    for (const variant of componentSet.children) {
      if (variant.type !== 'COMPONENT') continue;
      if (seenVariantIds.has(variant.id)) continue;
      seenVariantIds.add(variant.id);

      const { properties, rawProperties } = parseVariantProperties(variant.name, propertyOptions);
      const entry: any = {
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

  const variantValueEnums: any = {};
  const variantProperties: any = {};
  Object.keys(propertyOptions)
    .sort()
    .forEach((normalizedKey: string) => {
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

  // Only use properties defined at the component SET level.
  // Variant-level property references are NOT valid for Code Connect
  // (the SDK validates against the set's componentPropertyDefinitions).
  const componentProperties = extractComponentProperties(componentSet);

  // Extract text layers and slot layers for Code Connect helpers
  const textLayers = extractTextLayers(componentSet, layerDepth);
  const slotLayers = extractSlotLayers(componentSet, layerDepth);

  const basePayload: any = {
    componentSetId: componentSet.id,
    componentName: componentSet.name,
    variantProperties,
    variantValueEnums,
    componentProperties,
    textLayers: textLayers.length > 0 ? textLayers : null,
    slotLayers: slotLayers.length > 0 ? slotLayers : null,
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

async function saveJson(filePath: string, data: any, options: any = {}): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = await stringifyCompact(data);
  fs.writeFileSync(filePath, content, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath) || filePath;
  const { logMessage } = options;
  if (logMessage !== false) {
    const message = typeof logMessage === 'string' ? logMessage : `\n${chalk.green('✓')} Saved: ${relativePath}`;
    console.log(message);
  }
}

function sanitizeFilename(name: any): string {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
}

async function main(): Promise<void> {
  const config = parseArgs();
  if (!config.fileKey) {
    console.error(chalk.red('Error: Figma file key is required'));
    process.exit(1);
  }
  if (!config.token) {
    console.error(chalk.red('Error: Figma API token is required (set FIGMA_ACCESS_TOKEN or use --token)'));
    process.exit(1);
  }

  console.log(chalk.bold('   Fetching Figma file...'));
  console.log(`File Key: ${figmaColor(config.fileKey)}`);

  try {
    const fileData = await figmaRequest(`/v1/files/${config.fileKey}`, config.token);
    console.log(`${chalk.green('✓')} Figma file loaded: ${fileData.name}`);
    console.log(`  Version: ${fileData.version}`);
    console.log(`  Last Modified: ${fileData.lastModified}`);

    const pages = fileData.document.children;
    console.log('\nProcessing pages in Figma document:');
    pages.forEach((page: any) => console.log(`  - ${figmaColor(page.name)}`));

  const allComponentSets = pages.flatMap((page: any) => findComponentSets(page));
  const visibleSets = allComponentSets.filter(({ node }: any) => !isHiddenComponent(node.name));
  const componentEntries = visibleSets.map(({ node, breadcrumbs }: any) => ({ componentSet: node, breadcrumbs }));

    console.log(`\n${chalk.green('✓')} Found ${componentEntries.length} Figma component sets`);

    let processedCount = 0;
    const componentsMeta: any[] = [];
    const usedFilenames = new Set<string>();

    for (const entry of componentEntries) {
      let { componentSet, breadcrumbs } = entry;

      // If component properties are missing, fetch the node directly to include definitions.
      if (!componentSet.componentPropertyDefinitions) {
        const enriched = await fetchComponentNode(config.fileKey, componentSet.id, config.token);
        if (enriched) {
          componentSet = enriched;
        }
      }

      const variantData = extractVariants(componentSet, breadcrumbs, config.layerDepth);
      const baseName = sanitizeFilename(componentSet.name) || 'component';
      let filename = baseName;
      let suffix = 1;
      while (usedFilenames.has(filename)) {
        filename = `${baseName}_${suffix}`;
        suffix += 1;
      }
      usedFilenames.add(filename);

      const jsonPath = path.join(config.output, `${filename}.json`);
      await saveJson(jsonPath, variantData, { logMessage: false });
      const relativePath = path.relative(process.cwd(), jsonPath) || jsonPath;
      const label = `${componentSet.name} (${variantData.totalVariants} variants)`;
      console.log(`${figmaColor(label)} → ${figmaColor(relativePath)}`);

      const componentName = variantData.componentName;
      const meta: any = {
        name: variantData.componentName,
        id: variantData.componentSetId,
        variantCount: variantData.totalVariants,
        checksum: variantData.checksum?.value || null,
        schemaVersion: variantData.schemaVersion
      };
      if (variantData.description) meta.description = variantData.description;
      const alias = variantData.nameAliases?.alias || '';
      const aliasCandidates = Array.isArray(variantData.nameAliases?.candidates)
        ? variantData.nameAliases.candidates.filter((a: any) => a && a !== componentName)
        : [];
      if (alias && alias !== componentName) meta.alias = alias;
      if (aliasCandidates.length) meta.aliases = aliasCandidates;
      const pathStr = variantData.breadcrumbs?.path || '';
      if (pathStr) meta.breadcrumbPath = pathStr;
      componentsMeta.push(meta);
      processedCount++;
    }

    // Write the canonical pipeline index: figma-components-index.json at repo root or provided path.
    const indexData: any = {
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
              .filter(({ node }: any) => !isHiddenComponent(node.name))
              .map(({ node }: any) => {
                const entry: any = {
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
    await saveJson(indexPath, indexData);

    console.log(`\n${chalk.green('✓')} Complete! Processed ${processedCount} component(s)`);
  } catch (error: any) {
    console.error(`\n${chalk.red('❌ Figma scan failed:')} ${error.message}`);
    
    // Provide context-specific guidance
    if (error.message.includes('Network') || error.message.includes('certificate') || error.message.includes('TLS')) {
      console.error('\n📝 See docs/NETWORK-TROUBLESHOOTING.md for detailed help with corporate network issues');
    } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
      console.error('\n💡 Token issue - verify FIGMA_ACCESS_TOKEN and permissions');
    } else if (error.message.includes('not found') || error.message.includes('404')) {
      console.error('\n💡 File not found - verify the Figma file key/URL');
    }
    
    if (process.env.SUPERCONNECT_E2E_VERBOSE === '1') {
      console.error(`\nStack trace:\n${error.stack}`);
    }
    
    process.exit(1);
  }
}

// Check if this is the main module (ESM equivalent of require.main === module)
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('figma-scan.ts') ||
                     process.argv[1]?.endsWith('figma-scan.js');

if (isMainModule) {
  main();
}

// Note: fetchComponentNode is referenced but not defined in original file
// Adding placeholder that matches the usage pattern
async function fetchComponentNode(fileKey: string, nodeId: string, token: string): Promise<any> {
  try {
    const data = await figmaRequest(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token);
    return data?.nodes?.[nodeId]?.document || null;
  } catch {
    return null;
  }
}
