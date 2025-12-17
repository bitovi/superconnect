const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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

const writeConfig = (dest) => {
  const toml = [
    '[inputs]',
    `figma_url = "${FIGMA_URL}"`,
    'component_repo_path = "."',
    '',
    '[agent]',
    'backend = "claude"',
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
    if (Array.isArray(subset) && subset.length > 0) {
      superconnectArgs.push('--only', subset.join(','));
    }
    run('node', superconnectArgs, { cwd: tmpDir, env });

    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((file) => file.endsWith('.figma.ts'))
      : [];
    expect(connectors.length).toBeGreaterThan(0);

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
