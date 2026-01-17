/**
 * Code Connect Validation Layer
 *
 * Two-tier validation approach:
 *
 * 1. FAST PRE-CHECK (validateCodeConnect):
 *    - AST-based validation using unified IR extractor
 *    - Validates figma.*() calls against Figma evidence
 *    - Validates template/JSX expressions for forbidden constructs
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

// @ts-nocheck - Mechanically converted from JS, needs type refinement

import { validateWithFigmaCLI } from './validate-with-figma-cli.ts';
import { extractIR } from './code-connect-ir.ts';

/**
 * Extract all figma.*() calls from generated code using the IR extractor.
 * @param code - The generated Code Connect file content
 * @returns Array of helper calls with key and line info
 */
export function extractFigmaCalls(code: string): Array<{helper: string, key: string, line: number}> {
  try {
    const ir = extractIR(code);
    const calls: any[] = [];

    // Extract helper calls from all figma.connect() calls
    for (const connect of ir.connects) {
      if (!connect.config || !connect.config.props) continue;
      if (!connect.config.props.isObjectLiteral) continue;

      for (const helper of connect.config.props.helpers) {
        if (helper.key && helper.keyLiteral) {
          calls.push({
            helper: helper.helper,
            key: helper.key,
            line: helper.loc?.start?.line || 1
          });
        }
      }
    }

    return calls;
  } catch (err) {
    // If parsing fails, return empty array - validation will catch it later
    // This allows tests with code snippets to still run
    return [];
  }
}

/**
 * Normalize a property key for comparison.
 * Strips leading dots and question marks (e.g., ".iconStart?" -> "iconstart")
 * @param key
 * @returns normalized key
 */
export function normalizeKey(key: string): string {
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
 * @param values - Variant values
 * @returns true if boolean variant
 */
function isBooleanVariant(values: any[]): boolean {
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
 * @param figmaEvidence
 * @returns Sets of valid keys by type
 */
export function buildValidKeySets(figmaEvidence: any): {
  stringKeys: Set<string>,
  booleanKeys: Set<string>,
  enumKeys: Set<string>,
  instanceKeys: Set<string>,
  textLayerNames: Set<string>,
  slotLayerNames: Set<string>
} {
  const stringKeys = new Set<string>();
  const booleanKeys = new Set<string>();
  const enumKeys = new Set<string>();
  const instanceKeys = new Set<string>();
  const textLayerNames = new Set<string>();
  const slotLayerNames = new Set<string>();

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
  componentProps.forEach((prop: any) => {
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
  textLayers.forEach((layer: any) => {
    if (layer && layer.name) {
      textLayerNames.add(normalizeKey(layer.name));
    }
  });

  // Add slot layers
  const slotLayers = figmaEvidence.slotLayers || [];
  slotLayers.forEach((layer: any) => {
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
 * @param call - {helper, key, line}
 * @param keySets - Sets of valid keys by type
 * @returns Error message or null if valid
 */
function validateCall(call: {helper: string, key: string, line: number}, keySets: any): string | null {
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
 * Validate structural invariants from IR.
 * Checks connect call structure, config object, example function, and forbidden expressions.
 * @param ir - IR from extractIR()
 * @returns Array of error messages
 */
function validateStructuralInvariants(ir: any): string[] {
  const errors: string[] = [];

  for (const connect of ir.connects) {
    const loc = connect.loc ? `:${connect.loc.start.line}` : '';

    // Check connect signature
    if (connect.kind === 'invalid') {
      errors.push(`${loc} Invalid figma.connect() signature - expected: figma.connect(Component, 'url', config) or figma.connect('url', config)`);
    }

    // Check URL is a string literal
    if (connect.url && !connect.url.isLiteral) {
      const urlLoc = connect.url.loc ? `:${connect.url.loc.start.line}` : '';
      errors.push(`${urlLoc} URL must be a string literal, not a variable or expression`);
    }

    // Check config is an object literal
    if (connect.config && !connect.config.isObjectLiteral) {
      const configLoc = connect.config.loc ? `:${connect.config.loc.start.line}` : '';
      errors.push(`${configLoc} Config must be an object literal, not a variable or expression`);
    }

    // Check example function structure
    if (connect.config && connect.config.example) {
      const example = connect.config.example;
      
      if (!example.isFunction) {
        const exLoc = example.loc ? `:${example.loc.start.line}` : '';
        errors.push(`${exLoc} Example must be a function`);
      } else {
        // Check for direct return (arrow function without block)
        if (example.hasBlock) {
          const exLoc = example.bodyLoc ? `:${example.bodyLoc.start.line}` : '';
          errors.push(`${exLoc} Example function must directly return an expression (arrow function without braces). Found block statement. Use: example: (props) => <Component /> not example: (props) => { return <Component /> }`);
        }

        // Check for forbidden expressions
        for (const forbidden of example.forbiddenExpressions) {
          const fLoc = forbidden.loc ? `:${forbidden.loc.start.line}` : '';
          
          switch (forbidden.type) {
            case 'ternary':
              errors.push(`${fLoc} Ternary expression (? :) not allowed in example. Use figma.boolean() or figma.enum() to map the condition in props instead`);
              break;
            case 'logical':
              errors.push(`${fLoc} Logical operator (${forbidden.operator}) not allowed in example. Use figma.boolean() to map the condition in props instead`);
              break;
            case 'binary':
              errors.push(`${fLoc} Binary expression (${forbidden.operator}) not allowed in example. Compute the value in props instead`);
              break;
            case 'unary':
              errors.push(`${fLoc} Unary operator (${forbidden.operator}) not allowed in example. Compute the value in props instead`);
              break;
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate enum mappings against Figma evidence.
 * Ensures that figma.enum() mappings only reference valid Figma variant values.
 * @param ir - IR from extractIR()
 * @param figmaEvidence - Figma evidence with variantProperties
 * @returns Array of error messages
 */
function validateEnumMappings(ir: any, figmaEvidence: any): string[] {
  const errors: string[] = [];
  const variantProps = figmaEvidence.variantProperties || {};

  for (const connect of ir.connects) {
    if (!connect.config || !connect.config.props || !connect.config.props.isObjectLiteral) {
      continue;
    }

    for (const helper of connect.config.props.helpers) {
      if (helper.helper !== 'enum' || !helper.enumMapping) continue;
      if (!helper.enumMapping.isObjectLiteral) continue;

      const axis = helper.key;
      const axisNormalized = normalizeKey(axis);
      
      // Find the variant property (case-insensitive match)
      let figmaValues: any[] | null = null;
      for (const [key, values] of Object.entries(variantProps)) {
        if (normalizeKey(key) === axisNormalized) {
          figmaValues = values as any[];
          break;
        }
      }

      if (!figmaValues) {
        // Axis doesn't exist - this is caught by validateCall, skip here
        continue;
      }

      // Validate each mapping key
      const figmaValuesNormalized = new Set(figmaValues.map(v => String(v).toLowerCase()));
      
      for (const mapping of helper.enumMapping.mappings) {
        const figmaValue = mapping.figmaValue;
        const figmaValueNormalized = String(figmaValue).toLowerCase();
        
        if (!figmaValuesNormalized.has(figmaValueNormalized)) {
          const loc = helper.loc ? `Line ${helper.loc.start.line}:` : '';
          const availableValues = figmaValues.join(', ');
          errors.push(`${loc} figma.enum('${axis}', ...) - '${figmaValue}' is not a valid value for variant '${axis}'. Available values: ${availableValues}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validate a generated Code Connect file against Figma evidence.
 *
 * @param options
 * @param options.generatedCode - The .figma.tsx/.figma.ts content
 * @param options.figmaEvidence - Per-component JSON from figma-scan.js
 * @param options.orienterOutput - Orienter output (for component import validation, optional)
 * @returns Validation result with errors array
 */
export function validateCodeConnect({ generatedCode, figmaEvidence, orienterOutput = null }: { generatedCode: string, figmaEvidence: any, orienterOutput?: any }): { valid: boolean, errors: string[] } {
  const errors: string[] = [];

  if (!generatedCode || typeof generatedCode !== 'string') {
    return { valid: false, errors: ['Generated code is empty or invalid'] };
  }

  if (!figmaEvidence || typeof figmaEvidence !== 'object') {
    return { valid: false, errors: ['Figma evidence is missing or invalid'] };
  }

  // Parse the code using IR extractor
  let ir: any;
  try {
    ir = extractIR(generatedCode);
  } catch (err: any) {
    // Parse error - return immediately with error details
    return { valid: false, errors: [err.message] };
  }

  // Check for figma.connect call
  if (ir.connects.length === 0) {
    errors.push('Missing figma.connect() call');
  }

  // Check for Code Connect import
  const hasFigmaImport = ir.imports.some((imp: any) => 
    imp.source === '@figma/code-connect/react' ||
    imp.source === '@figma/code-connect/html' ||
    imp.source === '@figma/code-connect'
  );

  if (!hasFigmaImport) {
    errors.push('Missing @figma/code-connect import');
  }

  // Validate structural invariants from IR
  const structuralErrors = validateStructuralInvariants(ir);
  errors.push(...structuralErrors);

  // Validate enum mappings against Figma evidence
  const enumErrors = validateEnumMappings(ir, figmaEvidence);
  errors.push(...enumErrors);

  // Extract all figma.*() helper calls from IR
  const calls = extractFigmaCalls(generatedCode);

  // Build valid key sets
  const keySets = buildValidKeySets(figmaEvidence);

  // Validate each helper call
  calls.forEach((call) => {
    const error = validateCall(call, keySets);
    if (error) {
      errors.push(error);
    }
  });

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
 * @param code - The generated code
 * @returns Array of error messages
 */
export function checkTemplateInterpolations(code: string): string[] {
  const errors: string[] = [];
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
    // Exclude ? inside string literals (e.g., ".isCompact?" in variant restrictions)
    const lineWithoutStrings = line.replace(/["'][^"']*["']/g, '""');
    const hasTernary = lineWithoutStrings.includes('?') && lineWithoutStrings.includes(':');
    if (hasTernary) {
      const inJsxContext = /</.test(lineWithoutStrings) || /\{[^}]*\?/.test(lineWithoutStrings);
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
 * @param options
 * @param options.generatedCode - The .figma.tsx/.figma.ts content
 * @param options.figmaEvidence - Per-component JSON from figma-scan.js
 * @param options.framework - Target framework
 * @param options.skipCLI - Skip CLI validation (for testing)
 * @returns Validation result with errors array
 */
export function validateCodeConnectWithCLI({ 
  generatedCode, 
  figmaEvidence, 
  framework = 'react',
  skipCLI = false 
}: {
  generatedCode: string,
  figmaEvidence: any,
  framework?: 'react' | 'angular',
  skipCLI?: boolean
}): { valid: boolean, errors: string[] } {
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
