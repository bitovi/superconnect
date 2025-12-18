/**
 * Code Connect Validation Layer
 *
 * Two-tier validation approach:
 *
 * 1. FAST PRE-CHECK (validateCodeConnect):
 *    - Hybrid validation: AST for figma.*() calls, regex for template expressions
 *    - Validates figma.*() calls against Figma evidence using ts-morph AST
 *    - Validates template/JSX expressions using regex patterns
 *    - Catches obvious errors before spawning CLI
 *
 * 2. CLI VALIDATION (validateCodeConnectWithCLI):
 *    - Uses the official Figma CLI as authoritative validator
 *    - Catches Code Connect API errors (e.g., non-literal objects)
 *    - Runs fast pre-check first, then CLI if pre-check passes
 *
 * Pre-check validates:
 * - figma.string('KEY') - KEY must exist in componentProperties (TEXT) or variantProperties
 * - figma.boolean('KEY') - KEY must exist in componentProperties (BOOLEAN) or variantProperties
 * - figma.enum('KEY', {...}) - KEY must exist in variantProperties
 * - figma.instance('KEY') - KEY must exist in componentProperties (INSTANCE_SWAP)
 * - figma.textContent('LayerName') - LayerName must exist in textLayers
 * - figma.children('LayerName') - LayerName must exist in slotLayers
 *
 * CLI validation catches:
 * - Props used in example() but not defined in props object
 * - Code Connect API structure violations
 *
 * Note: Neither layer validates TypeScript/JSX syntax. The Figma CLI uses
 * a tolerant parser. See docs/FIGMA-CLI-VALIDATION.md for details.
 */

const { validateWithFigmaCLI } = require('./validate-with-figma-cli');
const { Project, SyntaxKind, Node } = require('ts-morph');

/**
 * Extract all figma.*() calls from generated code using AST traversal.
 * @param {string} code - The generated Code Connect file content
 * @returns {Array<{helper: string, key: string, line: number}>}
 */
function extractFigmaCalls(code) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('temp.tsx', code, { scriptKind: 2 }); // TSX
  
  const calls = [];
  
  // Find all call expressions
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(callExpr => {
    const expr = callExpr.getExpression();
    
    // Check if it's a property access (figma.something)
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr;
      const object = propAccess.getExpression().getText();
      const property = propAccess.getName();
      
      if (object === 'figma') {
        // Skip figma.connect()
        if (property === 'connect') {
          return;
        }
        
        // Get the first argument (the key)
        const args = callExpr.getArguments();
        if (args.length > 0) {
          const firstArg = args[0];
          
          // Check if it's a string literal
          if (firstArg.getKind() === SyntaxKind.StringLiteral) {
            const key = firstArg.getText().replace(/['"]/g, '');
            calls.push({
              helper: property,
              key: key,
              line: firstArg.getStartLineNumber()
            });
          }
        }
      }
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
 * Check if a variant property is a boolean variant.
 * Boolean variants have exactly 2 values that are:
 * - "True"/"False"
 * - "Yes"/"No"
 * - "On"/"Off"
 * (case insensitive)
 * @param {Array<string>} values - Variant values
 * @returns {boolean}
 */
function isBooleanVariant(values) {
  if (!Array.isArray(values) || values.length !== 2) return false;
  
  const normalized = values.map(v => String(v).toLowerCase()).sort();
  const pairs = [
    ['false', 'true'],
    ['no', 'yes'],
    ['off', 'on']
  ];
  
  return pairs.some(pair => 
    normalized[0] === pair[0] && normalized[1] === pair[1]
  );
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
    // Boolean variants (True/False, Yes/No, On/Off) can use figma.boolean()
    if (isBooleanVariant(variantProps[key])) {
      booleanKeys.add(normalized);
    }
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

  // Check for invalid JavaScript expressions in template interpolations
  // Code Connect doesn't allow ternaries, conditionals, or binary operators in ${} placeholders
  const templateInterpolationErrors = checkTemplateInterpolations(generatedCode);
  errors.push(...templateInterpolationErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check for invalid JavaScript expressions using AST (ternaries, logical ops, etc.)
 * Code Connect doesn't allow ternaries (?:), logical operators (&&, ||), or binary expressions.
 * Also checks for syntax errors (e.g. bare expressions in JSX not wrapped in braces).
 * @param {string} code - The generated code
 * @returns {string[]} - Array of error messages
 */
function checkTemplateInterpolations(code) {
  const errors = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Skip import lines and comments
    if (line.trim().startsWith('import ') || line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      return;
    }

    // Check for ternary expressions inside ${} (template literals)
    if (/\$\{[^}]*\?[^}]*:[^}]*\}/.test(line)) {
      errors.push(`Line ${lineNum}: Ternary expression in template interpolation - Code Connect doesn't allow conditionals. Compute value in props instead.`);
    }

    // Check for ternary expressions in JSX context (both inside {} and bare)
    const hasTernary = line.includes('?') && line.includes(':');
    if (hasTernary) {
      const inJsxContext = /</.test(line) || /\{[^}]*\?/.test(line);
      const isUrl = /https?:\/\//.test(line);
      
      if (inJsxContext && !isUrl) {
        errors.push(`Line ${lineNum}: Ternary expression in JSX - Code Connect doesn't allow conditionals. Use figma.boolean() to map the condition instead.`);
      }
    }

    // Check for logical AND/OR inside ${} (template literals)
    if (/\$\{[^}]*(?:&&|\|\|)[^}]*\}/.test(line)) {
      errors.push(`Line ${lineNum}: Logical operator in template interpolation - Code Connect doesn't allow &&/||. Compute value in props instead.`);
    }

    // Check for prefix unary operators inside ${} (template literals)
    if (/\$\{\s*(?:!|~|\+|-|typeof\b|void\b|delete\b)/.test(line)) {
      errors.push(`Line ${lineNum}: Prefix unary operator in template interpolation - Code Connect doesn't allow !/~/+/-/typeof/void/delete in \${} placeholders. Compute the value in props instead.`);
    }

    // Check for logical operators in JSX context (both inside {} and bare)
    const hasLogicalOp = /(?:&&|\|\|)/.test(line);
    if (hasLogicalOp) {
      const inJsxContext = /</.test(line) || /\{[^}]*(?:&&|\|\|)/.test(line);
      const isRegularJs = /^\s*(?:if|while|for|function|const|let|var|return)\s/.test(line);
      
      if (inJsxContext && !isRegularJs) {
        errors.push(`Line ${lineNum}: Logical operator in JSX - Code Connect doesn't allow &&/||. Use figma.boolean() to map the condition instead.`);
      }
    }

    // Check for backtick nesting inside ${} (nested template literals)
    if (/\$\{[^}]*`[^`]*`[^}]*\}/.test(line)) {
      errors.push(`Line ${lineNum}: Nested template literal in interpolation - Code Connect doesn't allow this. Compute string in props instead.`);
    }

    // Check for comparison operators inside ${} or {}
    if (/\$\{[^}]*(?:===|!==|==|!=|<=|>=)[^}]*\}/.test(line)) {
      errors.push(`Line ${lineNum}: Comparison operator in template interpolation - Code Connect doesn't allow binary expressions. Compute value in props instead.`);
    }
    if (/=["']\$\{[^}]*(?:===|!==|==|!=|<=|>=)[^}]*\}["']/.test(line)) {
      errors.push(`Line ${lineNum}: Comparison operator in attribute - Code Connect doesn't allow binary expressions. Compute boolean value in props instead.`);
    }

    // Check for comparison operators in JSX context
    const hasComparison = /(?:===|!==|==|!=|<=|>=)/.test(line);
    if (hasComparison) {
      const inJsxContext = (/</.test(line) || /\{[^}]*(?:===|!==)/.test(line)) && 
                           !line.includes('node-id=') && 
                           !line.includes('figma.connect');
      
      if (inJsxContext) {
        errors.push(`Line ${lineNum}: Comparison operator in JSX - Code Connect doesn't allow binary expressions. Compute boolean value in props instead.`);
      }
    }
  });

  // Check for function bodies with statements before return (HTML templates only)
  const exampleFnMatch = code.match(/example:\s*\([^)]*\)\s*=>\s*\{/);
  if (exampleFnMatch) {
    errors.push(`Example function has a body with statements - Code Connect requires arrow function to directly return template: example: (props) => html\`...\` not example: (props) => { ... return html\`...\` }`);
  }

  return errors;
}

/**
 * Full validation using Figma CLI as the authoritative source.
 *
 * This is the recommended validation approach:
 * 1. Run fast pre-checks (structure, figma.*() calls) to catch obvious errors
 * 2. Run Figma CLI parse to catch all remaining errors
 *
 * @param {object} options
 * @param {string} options.generatedCode - The .figma.tsx/.figma.ts content
 * @param {object} options.figmaEvidence - Per-component JSON from figma-scan.js
 * @param {'react'|'angular'} [options.framework='react'] - Target framework
 * @param {boolean} [options.skipCLI=false] - Skip CLI validation (for testing)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCodeConnectWithCLI({ 
  generatedCode, 
  figmaEvidence, 
  framework = 'react',
  skipCLI = false 
}) {
  // Step 1: Run fast pre-checks
  const preCheckResult = validateCodeConnect({ generatedCode, figmaEvidence });
  if (!preCheckResult.valid) {
    return preCheckResult;
  }

  // Step 2: Skip CLI if requested (for testing)
  if (skipCLI) {
    return preCheckResult;
  }

  // Step 3: Run CLI validation
  const parser = framework === 'angular' ? 'html' : 'react';

  const cliResult = validateWithFigmaCLI({
    code: generatedCode,
    parser
  });

  return cliResult;
}

module.exports = {
  validateCodeConnect,
  validateCodeConnectWithCLI,
  extractFigmaCalls,
  buildValidKeySets,
  normalizeKey,
  checkTemplateInterpolations
};
