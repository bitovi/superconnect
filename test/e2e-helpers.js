/**
 * E2E Test Helpers
 * 
 * Shared utilities for Chakra and ZapUI end-to-end tests.
 * 
 * DESIGN PRINCIPLES:
 * 1. Semantic validation uses exact matching, not fuzzy/substring matching
 * 2. One assertion = one { figma, prop, helper } tuple
 * 3. Assertions read like English: "Figma property 'Size' maps to prop 'size' using 'enum'"
 * 4. Failures identify exactly which mapping failed
 */

const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractIR } = require('../src/util/code-connect-ir');

// -----------------------------------------------------------------------------
// Semantic Assertions Spec
// -----------------------------------------------------------------------------
// 
// Each component lists the mappings we REQUIRE to exist.
// Format: { figma: 'FigmaPropertyName', prop: 'codePropName', helper: 'helperType' }
//
// - `figma`: Exact Figma property name as it appears in the Figma file
// - `prop`: Expected code prop name in the generated Code Connect
// - `helper`: Expected figma helper type (enum, boolean, string, children, instance)
//
// These are human-authored expectations based on inspecting the Figma files.
// They form the "semantic contract" - if the LLM maps to different props, tests fail.
// -----------------------------------------------------------------------------

const SEMANTIC_ASSERTIONS = {
  // ============================================================================
  // ZapUI - Angular design system
  // Figma file: https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-
  // NOTE: ZapUI uses Title Case for Figma property names (e.g., "Size" not "size")
  // 
  // Verified from:
  // - Figma evidence JSON (superconnect/figma-components/*.json)
  // - ZapUI component source (projects/zap/core/*/*.component.ts)
  // ============================================================================
  zapui: {
    Button: [
      // Figma: Size, Status, Style, Icon, Icon position, Image, Mode, State, Corner radius
      // Code (button.component.ts): size, type, shape, variant, icon, iconPosition
      // Verified: Figma "Status" (Primary/Secondary/etc) → code "type" input
      { figma: 'Size', prop: 'size', helper: 'enum' },
      { figma: 'Status', prop: 'type', helper: 'enum' }
    ],
    Alert: [
      // Figma: Type, Style, Icon, Mode, Supporting text
      // Code (alert.component.ts): type, shape, variant, icon
      // Verified: Figma "Type" (Basic/Error/Info/Success/Warning) → code "type" input
      { figma: 'Type', prop: 'type', helper: 'enum' }
    ],
    Checkbox: [
      // Figma: Check (Checked/Indeterminate/Unchecked), Mode, State, Text
      // Code (checkbox.component.ts): checked = model<boolean>()
      // Verified: Figma "Check" → code "checked" binding via variant restrictions
      { figma: 'Check', prop: 'checked', helper: 'enum' }
    ]
  },
  
  // ============================================================================
  // Chakra UI - React design system  
  // Figma file: https://www.figma.com/design/7jkNETbphjIb9ap1M7H1o4/Chakra-UI----Figma-Kit--v3---Community-
  // NOTE: Chakra uses camelCase for Figma property names (e.g., "size" not "Size")
  //
  // Verified from:
  // - Figma evidence JSON (superconnect/figma-components/*.json)
  // - Chakra theme recipes (packages/react/src/theme/recipes/*.ts)
  // ============================================================================
  chakra: {
    Button: [
      // Figma: size, variant, colorPalette, state
      // Recipe (button.ts): size (2xs-2xl), variant (solid/subtle/surface/outline/ghost/plain), colorPalette
      // Note: "state" (default/hover) is a visual state, not a code prop - correctly omitted
      // Verified: Figma camelCase props → code props directly
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' },
      { figma: 'colorPalette', prop: 'colorPalette', helper: 'enum' }
    ],
    Alert: [
      // Figma: status, variant, size
      // Recipe (alert.ts): status (info/warning/success/error/neutral), variant (subtle/solid/outline/surface)
      // Verified: Figma camelCase props → code props directly
      { figma: 'status', prop: 'status', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' }
    ],
    Input: [
      // Figma: size, variant, state, type, .isFilled?, .isInvalid?, orientation
      // Recipe: size (2xs-2xl), variant (flushed/outline/subtle)
      // Note: "state" (default/disabled/focus) is visual, "type" is for addon variants
      // Verified: Figma camelCase props → code props directly
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' }
    ],
    Dialog: [
      // Figma: size (xs/sm/md/lg/xl/full)
      // Only variant property; also has boolean props like .closeTrigger?, .footer?
      // Verified: Figma size → code size
      { figma: 'size', prop: 'size', helper: 'enum' }
    ],
    Popover: [
      // Figma variants: size (xs/sm/md/lg)
      // Figma booleans: .showArrow?, .popoverTitle?, .popoverText?, .inputField?
      // Verified: size enum + boolean visibility props
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: '.showArrow?', prop: 'showArrow', helper: 'boolean' }
    ],
    Avatar: [
      // Figma variants: size, shape, variant, colorPalette, Avatar-item, .showImage?
      // Figma booleans: .badge?, .ring?
      // Verified: Multiple enum props + booleans
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: 'shape', prop: 'shape', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' }
    ],
    NumberInput: [
      // Figma variants: size, variant, state, orientation, .isFilled?, .isInvalid?
      // Figma booleans: .isRequired?, .isOptional?, .helperText?
      // Figma text: errorText, helperText, value
      // Verified: size + variant enums, boolean props
      { figma: 'size', prop: 'size', helper: 'enum' },
      { figma: 'variant', prop: 'variant', helper: 'enum' },
      { figma: '.isRequired?', prop: 'isRequired', helper: 'boolean' }
    ]
  }
};

/**
 * Validate that a component's generated Code Connect satisfies semantic assertions.
 * 
 * Handles two valid Code Connect patterns:
 * 1. Props-based: `props: { type: figma.enum('Type', {...}) }` with dynamic example
 * 2. Variant-based: `variant: { Type: 'Success' }` with explicit example
 * 
 * Both patterns are valid per Figma docs. We check that each asserted Figma property
 * is mapped correctly via EITHER approach.
 * 
 * @param {string} componentName - Component name (e.g., 'Button')
 * @param {object} ir - Extracted IR from code-connect-ir.js
 * @param {string} designSystem - 'chakra' or 'zapui'
 * @throws {Error} If any assertion fails, with clear message identifying the failure
 * 
 * @example
 * const ir = extractIR(generatedCode, 'button.figma.ts');
 * validateSemanticAssertions('Button', ir, 'zapui');
 */
function validateSemanticAssertions(componentName, ir, designSystem) {
  const assertions = SEMANTIC_ASSERTIONS[designSystem]?.[componentName];
  
  if (!assertions) {
    throw new Error(
      `No semantic assertions defined for ${designSystem}/${componentName}. ` +
      `Add them to SEMANTIC_ASSERTIONS in test/e2e-helpers.js`
    );
  }
  
  expect(ir.connects.length).toBeGreaterThan(0);
  
  // Collect all helpers from props-based connects
  const allHelpers = ir.connects
    .flatMap(c => c.config?.props?.helpers || []);
  
  // Collect all variant restrictions (extract the restrictions object from each)
  const allVariantRestrictions = ir.connects
    .map(c => c.config?.variant?.restrictions)
    .filter(Boolean);
  
  const hasPropsApproach = allHelpers.length > 0;
  const hasVariantApproach = allVariantRestrictions.length > 0;
  
  if (!hasPropsApproach && !hasVariantApproach) {
    throw new Error(
      `${designSystem}/${componentName}: No props or variant mappings found. ` +
      `Expected at least one figma.connect() with props helpers or variant restrictions.`
    );
  }
  
  for (const { figma, prop, helper } of assertions) {
    // First, check props-based approach
    const propsMapping = allHelpers.find(h => h.key === figma);
    
    if (propsMapping) {
      // Found in props - validate prop name and helper
      if (propsMapping.propName.toLowerCase() !== prop.toLowerCase()) {
        throw new Error(
          `${designSystem}/${componentName}: Figma property '${figma}' mapped to wrong prop. ` +
          `Expected: '${prop}', Got: '${propsMapping.propName}'`
        );
      }
      
      if (propsMapping.helper !== helper) {
        throw new Error(
          `${designSystem}/${componentName}: Figma property '${figma}' used wrong helper. ` +
          `Expected: '${helper}', Got: '${propsMapping.helper}'`
        );
      }
      continue; // Assertion satisfied via props
    }
    
    // Second, check variant-based approach
    const hasVariantForProperty = allVariantRestrictions.some(r => figma in r);
    
    if (hasVariantForProperty) {
      // Figma property is used in variant restrictions
      // This is a valid approach - the mapping is explicit in the example
      continue; // Assertion satisfied via variant restrictions
    }
    
    // Neither approach found this mapping
    throw new Error(
      `${designSystem}/${componentName}: Missing mapping for Figma property '${figma}'. ` +
      `Expected it to map to prop '${prop}' using '${helper}' helper (or variant restriction). ` +
      `Available props: ${allHelpers.map(h => h.key).filter(Boolean).join(', ') || '(none)'}. ` +
      `Available variant keys: ${[...new Set(allVariantRestrictions.flatMap(Object.keys))].join(', ') || '(none)'}`
    );
  }
}

/**
 * Get the list of components to test from environment variable.
 * @param {string} envVarName - e.g., 'ZAPUI_E2E_ONLY' or 'CHAKRA_E2E_ONLY'
 * @returns {string[]|null} Array of component names, or null if not set
 */
function getOnlyList(envVarName) {
  const raw = process.env[envVarName];
  if (!raw) return null;
  return String(raw)
    .split(/[, ]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Check if we should preserve test artifacts after run.
 * Uses unified E2E_KEEP env var (set by test-e2e.js script).
 */
function shouldKeepArtifacts() {
  const val = process.env.E2E_KEEP;
  if (!val) return false;
  const normalized = String(val).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Read a value from environment or .env file.
 * @param {string} key - Environment variable name
 * @returns {string|null}
 */
function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const match = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find(line => line.startsWith(`${key}=`));
  if (!match) return null;
  const [, value] = match.split('=');
  return value ? value.trim() : null;
}

/**
 * Run a command and return its output. Throws on non-zero exit.
 * @param {string} cmd - Command to run
 * @param {string[]} args - Arguments
 * @param {object} options - spawnSync options (cwd, env, etc.)
 * @returns {string} Combined stdout + stderr
 */
function run(cmd, args, options) {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[cmd].concat(args).join(' ')}\n${output}`);
  }
  return output;
}

/**
 * Write superconnect.toml configuration file.
 * @param {string} destDir - Directory to write to
 * @param {string} figmaUrl - Figma file URL
 * @param {object} options - { agentApi, agentModel }
 */
function writeConfig(destDir, figmaUrl, options = {}) {
  const api = options.agentApi || 'anthropic';
  const model = options.agentModel || (api === 'anthropic-agents' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5');
  
  const toml = [
    '[inputs]',
    `figma_url = "${figmaUrl}"`,
    'component_repo_path = "."',
    '',
    '[agent]',
    `api = "${api}"`,
    `model = "${model}"`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(destDir, 'superconnect.toml'), toml, 'utf8');
}

/**
 * Get component connectors that were generated.
 * @param {string} outputDir - Path to codeConnect output directory
 * @returns {string[]} Array of .figma.ts or .figma.tsx filenames
 */
function getGeneratedConnectors(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir).filter(file => 
    file.endsWith('.figma.ts') || file.endsWith('.figma.tsx')
  );
}

/**
 * Validate a single component's generated Code Connect.
 * Combines structural (AST vs Figma evidence) and semantic (assertions) validation.
 * 
 * @param {object} params
 * @param {string} params.componentName - e.g., 'Button'
 * @param {string} params.codeConnectPath - Path to generated .figma.ts file
 * @param {string} params.figmaEvidencePath - Path to Figma evidence JSON (optional)
 * @param {string} params.designSystem - 'chakra' or 'zapui'
 * @param {Function} params.validateCodeConnect - Structural validator function
 */
function validateComponent({
  componentName,
  codeConnectPath,
  figmaEvidencePath,
  designSystem,
  validateCodeConnect
}) {
  const code = fs.readFileSync(codeConnectPath, 'utf8');
  const ir = extractIR(code, path.basename(codeConnectPath));
  
  // Structural validation (if evidence available)
  if (figmaEvidencePath && fs.existsSync(figmaEvidencePath)) {
    const figmaEvidence = fs.readJsonSync(figmaEvidencePath);
    const validation = validateCodeConnect({ generatedCode: code, figmaEvidence });
    
    if (!validation.valid) {
      throw new Error(
        `Structural validation failed for ${componentName}:\n` +
        validation.errors.map(e => `  - ${e}`).join('\n')
      );
    }
  }
  
  // Semantic validation
  validateSemanticAssertions(componentName, ir, designSystem);
}

module.exports = {
  SEMANTIC_ASSERTIONS,
  validateSemanticAssertions,
  validateComponent,
  getOnlyList,
  shouldKeepArtifacts,
  readEnvValue,
  run,
  writeConfig,
  getGeneratedConnectors
};
