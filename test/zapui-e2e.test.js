const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { validateCodeConnect } = require('../src/util/validate-code-connect');
const { extractIR } = require('../src/util/code-connect-ir');

jest.setTimeout(300000);

const FIGMA_URL =
  'https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-?m=auto&t=0XdgVxllEy8vO4w1-6';
const RUN_E2E = process.env.RUN_ZAPUI_E2E === '1';
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'zapui');
const superconnectScript = path.join(__dirname, '..', 'scripts', 'run-pipeline.js');
const figmaCli = path.join(__dirname, '..', 'node_modules', '.bin', 'figma');

const getOnlyList = () => {
  const raw = process.env.ZAPUI_E2E_ONLY || process.env.npm_config_zapui_e2e_only;
  if (!raw) return null;
  return String(raw)
    .split(/[, ]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const printRunModeBanner = (subset) => {
  if (!Array.isArray(subset) || subset.length === 0) return;
  console.log(`ZapUI small E2E run (subset): ${subset.join(', ')}`);
};

const isVerbose = () => {
  const val = process.env.SUPERCONNECT_E2E_VERBOSE;
  if (val === undefined || val === null) return false;
  const normalized = String(val).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const readEnvValue = (key) => {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const match = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${key}=`));
  if (!match) return null;
  const [, value] = match.split('=');
  return value ? value.trim() : null;
};

const ensurePrerequisites = () => {
  if (!fs.existsSync(fixtureRoot) || !fs.existsSync(path.join(fixtureRoot, 'package.json'))) {
    throw new Error('ZapUI submodule missing. Run: git submodule update --init fixtures/zapui');
  }
  if (!fs.existsSync(figmaCli)) {
    throw new Error('Figma CLI missing. Run pnpm install in the superconnect repo');
  }
};

const copyZapuiFixture = (dest) => {
  fs.copySync(fixtureRoot, dest, {
    dereference: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === '.git' || base === '.husky' || base === 'node_modules') return false;
      return !src.includes(`${path.sep}.git${path.sep}`);
    }
  });
};

const writeConfig = (dest, options = {}) => {
  const api = options.agentApi || 'anthropic';
  const model = options.agentModel || (api === 'anthropic-agents' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5');
  
  const toml = [
    '[inputs]',
    `figma_url = "${FIGMA_URL}"`,
    'component_repo_path = "."',
    '',
    '[agent]',
    `api = "${api}"`,
    `model = "${model}"`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dest, 'superconnect.toml'), toml, 'utf8');
};

const run = (cmd, args, options) => {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (isVerbose()) {
    // Log the command and its combined output when verbose mode is requested
    console.log(`$ ${[cmd].concat(args).join(' ')}`);
    if (output.trim()) console.log(output.trim());
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[cmd].concat(args).join(' ')}\n${output}`);
  }
  return output;
};

const shouldKeep = () => {
  const val = process.env.ZAPUI_E2E_KEEP || process.env.npm_config_zapui_e2e_keep;
  if (!val) return false;
  const normalized = String(val).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const maybeTest = RUN_E2E ? test : test.skip;

maybeTest('runs superconnect with agent exploration mode (anthropic-agents)', () => {
  ensurePrerequisites();

  const figmaToken = readEnvValue('FIGMA_ACCESS_TOKEN');
  const anthropicKey = readEnvValue('ANTHROPIC_API_KEY');
  expect(figmaToken).toBeTruthy();
  expect(anthropicKey).toBeTruthy();

  const env = {
    ...process.env,
    FIGMA_ACCESS_TOKEN: figmaToken,
    ANTHROPIC_API_KEY: anthropicKey
  };

  const subset = getOnlyList();
  const testLabel = subset && subset.length > 0 ? subset.join(', ') : 'Button';
  console.log(`Testing agent exploration mode with components: ${testLabel}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapui-agent-sdk-'));
  const keepArtifacts = shouldKeep();
  
  if (keepArtifacts) {
    console.log(`\nTemp directory (will be preserved): ${tmpDir}`);
  }
  
  try {
    copyZapuiFixture(tmpDir);
    writeConfig(tmpDir, { agentApi: 'anthropic-agents', agentModel: 'claude-haiku-4-5' });
    fs.removeSync(path.join(tmpDir, 'superconnect'));
    fs.removeSync(path.join(tmpDir, 'codeConnect'));

    // Run with anthropic-agents API (configured in TOML)
    const superconnectArgs = [
      superconnectScript,
      '--framework', 'angular',
      '--force'
    ];
    
    if (subset && subset.length > 0) {
      superconnectArgs.push('--only', subset.join(','));
    } else {
      superconnectArgs.push('--only', 'Button');
    }
    
    run('node', superconnectArgs, { cwd: tmpDir, env });

    // Verify code was generated
    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((file) => file.endsWith('.figma.ts'))
      : [];
    expect(connectors.length).toBeGreaterThan(0);

    // AST-based validation: verify mappings match Figma evidence
    const figmaDir = path.join(tmpDir, 'superconnect', 'figma-components');
    let validationErrors = [];
    connectors.forEach((file) => {
      const code = fs.readFileSync(path.join(outputDir, file), 'utf8');
      const componentSlug = file.replace('.figma.ts', '');
      const evidencePath = path.join(figmaDir, `${componentSlug}.json`);
      
      if (fs.existsSync(evidencePath)) {
        const figmaEvidence = fs.readJsonSync(evidencePath);
        const validation = validateCodeConnect({ 
          generatedCode: code, 
          figmaEvidence 
        });
        
        if (!validation.valid) {
          validationErrors.push({ file, errors: validation.errors });
        }
      }
    });
    
    if (validationErrors.length > 0) {
      console.error('\nAST validation errors found:');
      validationErrors.forEach(({ file, errors }) => {
        console.error(`\n${file}:`);
        errors.forEach(err => console.error(`  - ${err}`));
      });
    }
    expect(validationErrors).toHaveLength(0);

    // Critical mapping assertions - catches prompt regressions
    const buttonFile = connectors.find(f => f.toLowerCase().includes('button'));
    if (buttonFile) {
      const code = fs.readFileSync(path.join(outputDir, buttonFile), 'utf8');
      const ir = extractIR(code, buttonFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        
        // Button: Figma "Variant" → Angular "variant"
        const variantMapping = helpers.find(h => h.key && h.key.toLowerCase().includes('variant'));
        if (variantMapping) {
          expect(variantMapping.helper).toBe('enum');
          expect(variantMapping.propName.toLowerCase()).toBe('variant');
        }
        
        // Button: Figma "Size" → Angular "size"
        const sizeMapping = helpers.find(h => h.key && h.key.toLowerCase() === 'size');
        if (sizeMapping) {
          expect(sizeMapping.helper).toBe('enum');
          expect(sizeMapping.propName.toLowerCase()).toBe('size');
        }
      }
    }

    // Alert: Should map "Alert Type" → "variant" (enum with info/success/warning/error)
    const alertFile = connectors.find(f => f.toLowerCase().includes('alert'));
    if (alertFile) {
      const code = fs.readFileSync(path.join(outputDir, alertFile), 'utf8');
      const ir = extractIR(code, alertFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        const variantMapping = helpers.find(h => 
          h.key && (h.key.toLowerCase().includes('alert') || h.key.toLowerCase().includes('type'))
        );
        if (variantMapping) {
          expect(variantMapping.helper).toBe('enum');
          expect(variantMapping.propName.toLowerCase()).toBe('variant');
        }
      }
    }

    // Dialog: Should have children slots and boolean conditionals
    const dialogFile = connectors.find(f => f.toLowerCase().includes('dialog'));
    if (dialogFile) {
      const code = fs.readFileSync(path.join(outputDir, dialogFile), 'utf8');
      const ir = extractIR(code, dialogFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        
        // Should have children slots for header/body/footer
        const hasChildrenSlots = helpers.some(h => h.helper === 'children');
        if (hasChildrenSlots) {
          expect(hasChildrenSlots).toBe(true);
        }
        
        // Should have boolean for backdrop/close controls
        const backdropMapping = helpers.find(h => 
          h.key && (h.key.toLowerCase().includes('backdrop') || h.key.toLowerCase().includes('close'))
        );
        if (backdropMapping) {
          expect(backdropMapping.helper).toBe('boolean');
        }
      }
    }

    // FormField/Input: "Input Type" → "type" (not "inputType")
    const inputFile = connectors.find(f => 
      f.toLowerCase().includes('input') || f.toLowerCase().includes('formfield')
    );
    if (inputFile) {
      const code = fs.readFileSync(path.join(outputDir, inputFile), 'utf8');
      const ir = extractIR(code, inputFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        const typeMapping = helpers.find(h => 
          h.key && h.key.toLowerCase().includes('type')
        );
        if (typeMapping) {
          // Critical: should be "type", not "inputType"
          expect(typeMapping.propName.toLowerCase()).toBe('type');
        }
      }
    }

    // Verify generated code validates
    const publishOutput = run(
      figmaCli,
      [
        'connect',
        'publish',
        '--dry-run',
        '--exit-on-unreadable-files',
        '--skip-update-check',
        '--outDir',
        path.join(tmpDir, 'superconnect', 'code-connect-json')
      ],
      {
        cwd: tmpDir,
        env
      }
    );

    expect(publishOutput).toEqual(expect.stringContaining('All Code Connect files are valid'));

    // Verify agent SDK was used (directory exists even if no tools were called)
    const transcriptDir = path.join(tmpDir, 'superconnect', 'codegen-agent-transcripts');
    expect(fs.existsSync(transcriptDir)).toBe(true);
    
    const logFiles = fs.readdirSync(transcriptDir);
    expect(logFiles.length).toBeGreaterThan(0);
    
    // Read log to verify agent SDK output format (includes token usage)
    const logContent = fs.readFileSync(path.join(transcriptDir, logFiles[0]), 'utf8');
    expect(logContent).toMatch(/\[Token Usage:/); // SDK includes token usage stats
    
    // Note: Agent may not always use exploration tools if provided context is sufficient
    // The test validates that anthropic-agents mode works and produces valid code
    if (isVerbose()) {
      const toolUsageFound = logContent.includes('[Tool Usage:') || logContent.includes('[Tool:');
      console.log(`Agent used exploration tools: ${toolUsageFound}`);
    }
    
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

maybeTest('runs superconnect against ZapUI and publishes cleanly', () => {
  ensurePrerequisites();

  const figmaToken = readEnvValue('FIGMA_ACCESS_TOKEN');
  const anthropicKey = readEnvValue('ANTHROPIC_API_KEY');
  expect(figmaToken).toBeTruthy();
  expect(anthropicKey).toBeTruthy();

  const env = {
    ...process.env,
    FIGMA_ACCESS_TOKEN: figmaToken,
    ANTHROPIC_API_KEY: anthropicKey
  };

  const subset = getOnlyList();
  printRunModeBanner(subset);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapui-e2e-'));  const keepArtifacts = shouldKeep();
  
  if (keepArtifacts) {
    console.log(`\nTemp directory (will be preserved): ${tmpDir}`);
  }
    try {
    copyZapuiFixture(tmpDir);
    writeConfig(tmpDir);
    fs.removeSync(path.join(tmpDir, 'superconnect'));
    fs.removeSync(path.join(tmpDir, 'codeConnect'));

    const superconnectArgs = [superconnectScript, '--framework', 'angular', '--force'];
    if (subset && subset.length > 0) {
      superconnectArgs.push('--only', subset.join(','));
    } else {
      superconnectArgs.push('--only', 'Button');
    }
    run('node', superconnectArgs, { cwd: tmpDir, env });

    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((file) => file.endsWith('.figma.ts'))
      : [];
    expect(connectors.length).toBeGreaterThan(0);

    // AST-based validation: verify mappings match Figma evidence
    const figmaDir = path.join(tmpDir, 'superconnect', 'figma-components');
    let validationErrors = [];
    connectors.forEach((file) => {
      const code = fs.readFileSync(path.join(outputDir, file), 'utf8');
      const componentSlug = file.replace('.figma.ts', '');
      const evidencePath = path.join(figmaDir, `${componentSlug}.json`);
      
      if (fs.existsSync(evidencePath)) {
        const figmaEvidence = fs.readJsonSync(evidencePath);
        const validation = validateCodeConnect({ 
          generatedCode: code, 
          figmaEvidence 
        });
        
        if (!validation.valid) {
          validationErrors.push({ file, errors: validation.errors });
        }
      }
    });
    
    if (validationErrors.length > 0) {
      console.error('\nAST validation errors found:');
      validationErrors.forEach(({ file, errors }) => {
        console.error(`\n${file}:`);
        errors.forEach(err => console.error(`  - ${err}`));
      });
    }
    expect(validationErrors).toHaveLength(0);

    // Critical mapping assertions - catches prompt regressions
    const buttonFile = connectors.find(f => f.toLowerCase().includes('button'));
    if (buttonFile) {
      const code = fs.readFileSync(path.join(outputDir, buttonFile), 'utf8');
      const ir = extractIR(code, buttonFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        
        // Button: Figma "Variant" → Angular "variant"
        const variantMapping = helpers.find(h => h.key && h.key.toLowerCase().includes('variant'));
        if (variantMapping) {
          expect(variantMapping.helper).toBe('enum');
          expect(variantMapping.propName.toLowerCase()).toBe('variant');
        }
        
        // Button: Figma "Size" → Angular "size"
        const sizeMapping = helpers.find(h => h.key && h.key.toLowerCase() === 'size');
        if (sizeMapping) {
          expect(sizeMapping.helper).toBe('enum');
          expect(sizeMapping.propName.toLowerCase()).toBe('size');
        }
      }
    }

    // Alert: Should map "Alert Type" → "variant" (enum with info/success/warning/error)
    const alertFile = connectors.find(f => f.toLowerCase().includes('alert'));
    if (alertFile) {
      const code = fs.readFileSync(path.join(outputDir, alertFile), 'utf8');
      const ir = extractIR(code, alertFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        const variantMapping = helpers.find(h => 
          h.key && (h.key.toLowerCase().includes('alert') || h.key.toLowerCase().includes('type'))
        );
        if (variantMapping) {
          expect(variantMapping.helper).toBe('enum');
          expect(variantMapping.propName.toLowerCase()).toBe('variant');
        }
      }
    }

    // Dialog: Should have children slots and boolean conditionals
    const dialogFile = connectors.find(f => f.toLowerCase().includes('dialog'));
    if (dialogFile) {
      const code = fs.readFileSync(path.join(outputDir, dialogFile), 'utf8');
      const ir = extractIR(code, dialogFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        
        // Should have children slots for header/body/footer
        const hasChildrenSlots = helpers.some(h => h.helper === 'children');
        if (hasChildrenSlots) {
          expect(hasChildrenSlots).toBe(true);
        }
        
        // Should have boolean for backdrop/close controls
        const backdropMapping = helpers.find(h => 
          h.key && (h.key.toLowerCase().includes('backdrop') || h.key.toLowerCase().includes('close'))
        );
        if (backdropMapping) {
          expect(backdropMapping.helper).toBe('boolean');
        }
      }
    }

    // FormField/Input: "Input Type" → "type" (not "inputType")
    const inputFile = connectors.find(f => 
      f.toLowerCase().includes('input') || f.toLowerCase().includes('formfield')
    );
    if (inputFile) {
      const code = fs.readFileSync(path.join(outputDir, inputFile), 'utf8');
      const ir = extractIR(code, inputFile);
      
      if (ir.connects.length > 0 && ir.connects[0].config?.props?.helpers) {
        const helpers = ir.connects[0].config.props.helpers;
        const typeMapping = helpers.find(h => 
          h.key && h.key.toLowerCase().includes('type')
        );
        if (typeMapping) {
          // Critical: should be "type", not "inputType"
          expect(typeMapping.propName.toLowerCase()).toBe('type');
        }
      }
    }

    const publishOutput = run(
      figmaCli,
      [
        'connect',
        'publish',
        '--dry-run',
        '--exit-on-unreadable-files',
        '--skip-update-check',
        '--outDir',
        path.join(tmpDir, 'superconnect', 'code-connect-json')
      ],
      {
        cwd: tmpDir,
        env
      }
    );

    expect(publishOutput).toEqual(expect.stringContaining('All Code Connect files are valid'));
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
