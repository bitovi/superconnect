/**
 * ZapUI E2E Tests
 * 
 * Tests superconnect pipeline against ZapUI Angular design system.
 * 
 * VALIDATION LAYERS:
 * 1. Structural: `figma connect publish --dry-run` - validates Code Connect syntax
 * 2. Semantic: Assertions in e2e-helpers.js - validates correct Figma→prop mappings
 * 
 * RUN MODES:
 * - Full: RUN_ZAPUI_E2E=1 pnpm test:e2e:zapui
 * - Subset: RUN_ZAPUI_E2E=1 ZAPUI_E2E_ONLY=Button,Alert pnpm test:e2e:zapui
 * - Keep artifacts: ZAPUI_E2E_KEEP=1 (preserves temp dir for inspection)
 * - Verbose: SUPERCONNECT_E2E_VERBOSE=1 (logs commands and output)
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const { validateCodeConnect } = require('../src/util/validate-code-connect');
const {
  SEMANTIC_ASSERTIONS,
  validateSemanticAssertions,
  getOnlyList,
  shouldKeepArtifacts,
  readEnvValue,
  run,
  writeConfig,
  getGeneratedConnectors
} = require('./e2e-helpers');
const { extractIR } = require('../src/util/code-connect-ir');

jest.setTimeout(300000);

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const FIGMA_URL = 'https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-?m=auto&t=0XdgVxllEy8vO4w1-6';
const DESIGN_SYSTEM = 'zapui';
const FRAMEWORK = 'angular';

const RUN_E2E = process.env.RUN_ZAPUI_E2E === '1';
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'zapui');
const superconnectScript = path.join(__dirname, '..', 'scripts', 'run-pipeline.js');
const figmaCli = path.join(__dirname, '..', 'node_modules', '.bin', 'figma');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function ensurePrerequisites() {
  if (!fs.existsSync(fixtureRoot) || !fs.existsSync(path.join(fixtureRoot, 'package.json'))) {
    throw new Error('ZapUI submodule missing. Run: git submodule update --init fixtures/zapui');
  }
  if (!fs.existsSync(figmaCli)) {
    throw new Error('Figma CLI missing. Run pnpm install in the superconnect repo');
  }
}

function copyFixture(dest) {
  fs.copySync(fixtureRoot, dest, {
    dereference: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === '.git' || base === '.husky' || base === 'node_modules') return false;
      return !src.includes(`${path.sep}.git${path.sep}`);
    }
  });
}

function getEnvWithTokens() {
  const figmaToken = readEnvValue('FIGMA_ACCESS_TOKEN');
  const anthropicKey = readEnvValue('ANTHROPIC_API_KEY');
  expect(figmaToken).toBeTruthy();
  expect(anthropicKey).toBeTruthy();
  
  return {
    ...process.env,
    FIGMA_ACCESS_TOKEN: figmaToken,
    ANTHROPIC_API_KEY: anthropicKey
  };
}

/**
 * Run structural validation using AST check against Figma evidence.
 * Returns array of { file, errors } for any failures.
 */
function runStructuralValidation(outputDir, figmaDir, connectors) {
  const validationErrors = [];
  
  for (const file of connectors) {
    const code = fs.readFileSync(path.join(outputDir, file), 'utf8');
    const componentSlug = file.replace('.figma.ts', '');
    const evidencePath = path.join(figmaDir, `${componentSlug}.json`);
    
    if (fs.existsSync(evidencePath)) {
      const figmaEvidence = fs.readJsonSync(evidencePath);
      const validation = validateCodeConnect({ generatedCode: code, figmaEvidence });
      
      if (!validation.valid) {
        validationErrors.push({ file, errors: validation.errors });
      }
    }
  }
  
  return validationErrors;
}

/**
 * Run semantic validation for components that have assertions defined.
 * Only validates components that were generated AND have assertions.
 * @param {string} outputDir - Path to codeConnect output
 * @param {string[]} connectors - List of generated .figma.ts files
 * @param {string[]|null} subset - Optional subset filter (from --only flag)
 */
function runSemanticValidation(outputDir, connectors, subset = null) {
  const assertedComponents = Object.keys(SEMANTIC_ASSERTIONS[DESIGN_SYSTEM] || {});
  const errors = [];
  
  // If subset specified, only validate components in the subset
  const componentsToValidate = subset?.length 
    ? assertedComponents.filter(c => subset.some(s => c.toLowerCase() === s.toLowerCase()))
    : assertedComponents;
  
  for (const componentName of componentsToValidate) {
    const file = connectors.find(f => 
      f.toLowerCase().includes(componentName.toLowerCase())
    );
    
    if (!file) {
      errors.push({ 
        component: componentName, 
        error: `Expected ${componentName} to be generated but no matching file found` 
      });
      continue;
    }
    
    try {
      const code = fs.readFileSync(path.join(outputDir, file), 'utf8');
      const ir = extractIR(code, file);
      validateSemanticAssertions(componentName, ir, DESIGN_SYSTEM);
    } catch (err) {
      errors.push({ component: componentName, error: err.message });
    }
  }
  
  return errors;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

const maybeTest = RUN_E2E ? test : test.skip;

maybeTest('generates valid Code Connect with correct semantic mappings', () => {
  ensurePrerequisites();
  const env = getEnvWithTokens();
  
  const subset = getOnlyList('ZAPUI_E2E_ONLY');
  if (subset?.length) {
    console.log(`ZapUI E2E (subset): ${subset.join(', ')}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapui-e2e-'));
  const keepArtifacts = shouldKeepArtifacts();
  
  if (keepArtifacts) {
    console.log(`\nTemp directory (will be preserved): ${tmpDir}`);
  }
  
  try {
    // Setup
    copyFixture(tmpDir);
    writeConfig(tmpDir, FIGMA_URL, { agentApi: 'anthropic', agentModel: 'claude-haiku-4-5' });
    fs.removeSync(path.join(tmpDir, 'superconnect'));
    fs.removeSync(path.join(tmpDir, 'codeConnect'));

    // Run superconnect
    const args = [superconnectScript, '--framework', FRAMEWORK, '--force'];
    if (subset?.length) {
      args.push('--only', subset.join(','));
    }
    run('node', args, { cwd: tmpDir, env });

    // Verify files were generated
    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = getGeneratedConnectors(outputDir);
    expect(connectors.length).toBeGreaterThan(0);
    
    if (subset?.length) {
      expect(connectors.length).toBeGreaterThanOrEqual(subset.length);
    }

    // Layer 1: Structural validation (AST vs Figma evidence)
    const figmaDir = path.join(tmpDir, 'superconnect', 'figma-components');
    const structuralErrors = runStructuralValidation(outputDir, figmaDir, connectors);
    
    if (structuralErrors.length > 0) {
      console.error('\nStructural validation errors:');
      structuralErrors.forEach(({ file, errors }) => {
        console.error(`\n${file}:`);
        errors.forEach(err => console.error(`  - ${err}`));
      });
    }
    expect(structuralErrors).toHaveLength(0);

    // Layer 2: Semantic validation (correct Figma→prop mappings)
    const semanticErrors = runSemanticValidation(outputDir, connectors, subset);
    
    if (semanticErrors.length > 0) {
      console.error('\nSemantic validation errors:');
      semanticErrors.forEach(({ component, error }) => {
        console.error(`\n${component}: ${error}`);
      });
    }
    expect(semanticErrors).toHaveLength(0);

    // Layer 3: Figma CLI validation (authoritative)
    const publishOutput = run(
      figmaCli,
      [
        'connect', 'publish',
        '--dry-run',
        '--exit-on-unreadable-files',
        '--skip-update-check',
        '--outDir', path.join(tmpDir, 'superconnect', 'code-connect-json')
      ],
      { cwd: tmpDir, env }
    );
    expect(publishOutput).toContain('All Code Connect files are valid');

  } catch (error) {
    if (keepArtifacts) {
      console.error(`\n❌ Test failed. Artifacts preserved at: ${tmpDir}`);
      console.error(`   To inspect: cd ${tmpDir}`);
    }
    throw error;
  } finally {
    if (!keepArtifacts) {
      fs.removeSync(tmpDir);
    }
  }
});
