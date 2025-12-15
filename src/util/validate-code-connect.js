/**
 * Code Connect Validation Layer
 *
 * Validates generated .figma.tsx/.figma.ts files against Figma evidence
 * to catch common errors before accepting agent output.
 *
 * Validates:
 * - figma.string('KEY') - KEY must exist in componentProperties (TEXT) or variantProperties
 * - figma.boolean('KEY') - KEY must exist in componentProperties (BOOLEAN) or variantProperties
 * - figma.enum('KEY', {...}) - KEY must exist in variantProperties
 * - figma.instance('KEY') - KEY must exist in componentProperties (INSTANCE_SWAP)
 * - figma.textContent('LayerName') - LayerName must exist in textLayers
 * - figma.children('LayerName') - LayerName must exist in slotLayers
 */

/**
 * Extract all figma.*() calls from generated code using regex.
 * @param {string} code - The generated Code Connect file content
 * @returns {Array<{helper: string, key: string, line: number}>}
 */
function extractFigmaCalls(code) {
  const calls = [];
  const lines = code.split('\n');

  // Pattern to match figma.helper('key') or figma.helper("key")
  const helperPattern = /figma\.(string|boolean|enum|instance|textContent|children|nestedProps|className)\s*\(\s*['"]([^'"]+)['"]/g;

  lines.forEach((line, index) => {
    let match;
    while ((match = helperPattern.exec(line)) !== null) {
      calls.push({
        helper: match[1],
        key: match[2],
        line: index + 1
      });
    }
  });

  return calls;
}

/**
 * Normalize a property key for comparison.
 * Strips leading dots and question marks (e.g., ".iconStart?" -> "iconstart")
 * @param {string} key
 * @returns {string}
 */
function normalizeKey(key) {
  return (key || '')
    .replace(/^\./, '')
    .replace(/\?$/, '')
    .toLowerCase()
    .trim();
}

/**
 * Build a set of valid keys from Figma evidence.
 * @param {object} figmaEvidence
 * @returns {{
 *   stringKeys: Set<string>,
 *   booleanKeys: Set<string>,
 *   enumKeys: Set<string>,
 *   instanceKeys: Set<string>,
 *   textLayerNames: Set<string>,
 *   slotLayerNames: Set<string>
 * }}
 */
function buildValidKeySets(figmaEvidence) {
  const stringKeys = new Set();
  const booleanKeys = new Set();
  const enumKeys = new Set();
  const instanceKeys = new Set();
  const textLayerNames = new Set();
  const slotLayerNames = new Set();

  // Add variant properties (these are enum-like)
  const variantProps = figmaEvidence.variantProperties || {};
  Object.keys(variantProps).forEach((key) => {
    const normalized = normalizeKey(key);
    enumKeys.add(normalized);
    // Variant props can also be used with figma.string()
    stringKeys.add(normalized);
  });

  // Add component properties based on type
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
        // Unknown type - add to string keys as fallback
        stringKeys.add(normalized);
    }
  });

  // Add text layers
  const textLayers = figmaEvidence.textLayers || [];
  textLayers.forEach((layer) => {
    if (layer && layer.name) {
      textLayerNames.add(normalizeKey(layer.name));
    }
  });

  // Add slot layers
  const slotLayers = figmaEvidence.slotLayers || [];
  slotLayers.forEach((layer) => {
    if (layer && layer.name) {
      slotLayerNames.add(normalizeKey(layer.name));
    }
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

/**
 * Validate a single figma.*() call against valid keys.
 * @param {object} call - {helper, key, line}
 * @param {object} keySets - Sets of valid keys by type
 * @returns {string|null} - Error message or null if valid
 */
function validateCall(call, keySets) {
  const { helper, key, line } = call;
  const normalizedKey = normalizeKey(key);

  switch (helper) {
    case 'string':
      if (!keySets.stringKeys.has(normalizedKey) && !keySets.enumKeys.has(normalizedKey)) {
        return `Line ${line}: figma.string('${key}') - '${key}' is not a valid TEXT property or variant`;
      }
      break;

    case 'boolean':
      if (!keySets.booleanKeys.has(normalizedKey)) {
        return `Line ${line}: figma.boolean('${key}') - '${key}' is not a valid BOOLEAN property`;
      }
      break;

    case 'enum':
      if (!keySets.enumKeys.has(normalizedKey)) {
        return `Line ${line}: figma.enum('${key}', ...) - '${key}' is not a valid variant property`;
      }
      break;

    case 'instance':
      if (!keySets.instanceKeys.has(normalizedKey)) {
        return `Line ${line}: figma.instance('${key}') - '${key}' is not a valid INSTANCE_SWAP property`;
      }
      break;

    case 'textContent':
      if (!keySets.textLayerNames.has(normalizedKey)) {
        return `Line ${line}: figma.textContent('${key}') - '${key}' is not a known text layer name`;
      }
      break;

    case 'children':
      if (!keySets.slotLayerNames.has(normalizedKey)) {
        return `Line ${line}: figma.children('${key}') - '${key}' is not a known slot layer name`;
      }
      break;

    case 'nestedProps':
    case 'className':
      // These have different validation rules - skip for now
      break;

    default:
      // Unknown helper - warn but don't fail
      break;
  }

  return null;
}

/**
 * Validate a generated Code Connect file against Figma evidence.
 *
 * @param {object} options
 * @param {string} options.generatedCode - The .figma.tsx/.figma.ts content
 * @param {object} options.figmaEvidence - Per-component JSON from figma-scan.js
 * @param {object} [options.orienterOutput] - Orienter output (for component import validation, optional)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCodeConnect({ generatedCode, figmaEvidence, orienterOutput = null }) {
  const errors = [];

  if (!generatedCode || typeof generatedCode !== 'string') {
    return { valid: false, errors: ['Generated code is empty or invalid'] };
  }

  if (!figmaEvidence || typeof figmaEvidence !== 'object') {
    return { valid: false, errors: ['Figma evidence is missing or invalid'] };
  }

  // Extract all figma.*() calls
  const calls = extractFigmaCalls(generatedCode);

  // Build valid key sets
  const keySets = buildValidKeySets(figmaEvidence);

  // Validate each call
  calls.forEach((call) => {
    const error = validateCall(call, keySets);
    if (error) {
      errors.push(error);
    }
  });

  // Check for basic structure (has figma.connect call)
  if (!generatedCode.includes('figma.connect')) {
    errors.push('Missing figma.connect() call');
  }

  // Check for Code Connect import
  const hasReactImport = generatedCode.includes("from '@figma/code-connect/react'") ||
                          generatedCode.includes('from "@figma/code-connect/react"');
  const hasHtmlImport = generatedCode.includes("from '@figma/code-connect/html'") ||
                         generatedCode.includes('from "@figma/code-connect/html"') ||
                         generatedCode.includes("from '@figma/code-connect'") ||
                         generatedCode.includes('from "@figma/code-connect"');

  if (!hasReactImport && !hasHtmlImport) {
    errors.push('Missing @figma/code-connect import');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateCodeConnect,
  extractFigmaCalls,
  buildValidKeySets,
  normalizeKey
};
