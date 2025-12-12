const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { computeChakraBenchMetrics, compareChakraBenchMetrics } = require('./util/chakra-bench');

jest.setTimeout(1200000);

const FIGMA_URL =
  'https://www.figma.com/design/7jkNETbphjIb9ap1M7H1o4/Chakra-UI----Figma-Kit--v3---Community-?m=auto&t=0XdgVxllEy8vO4w1-6';
const DEFAULT_ONLY = [
  'Button',
  'Input',
  'Checkbox',
  'Switch',
  'Select',
  'Tabs.List',
  'Tabs.Trigger',
  'Accordion',
  'Tooltip',
  'Card'
];
const RUN_E2E = process.env.RUN_CHAKRA_E2E === '1';
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'chakra-ui');
const superconnectScript = path.join(__dirname, '..', 'scripts', 'run-pipeline.js');
const figmaCli = path.join(__dirname, '..', 'node_modules', '.bin', 'figma');
const baselinePath = path.join(__dirname, 'baselines', 'chakra-metrics.json');

const normalizeBoolEnv = (val) => {
  if (!val) return false;
  const normalized = String(val).toLowerCase().trim();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const shouldRecordBaseline = () =>
  normalizeBoolEnv(process.env.CHAKRA_E2E_RECORD || process.env.npm_config_chakra_e2e_record);

const readBaselineMetrics = () => {
  if (!fs.existsSync(baselinePath)) return null;
  try {
    return fs.readJsonSync(baselinePath);
  } catch {
    return null;
  }
};

const writeBaselineMetrics = (metrics) => {
  fs.ensureDirSync(path.dirname(baselinePath));
  fs.writeJsonSync(baselinePath, metrics, { spaces: 2 });
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

const getOnlyList = () => {
  const raw = process.env.CHAKRA_E2E_ONLY || process.env.npm_config_chakra_e2e_only;
  if (!raw) return null;
  if (String(raw).trim().toLowerCase() === 'default') return DEFAULT_ONLY;
  return raw
    .split(/[, ]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const getOnlyRaw = () => process.env.CHAKRA_E2E_ONLY || process.env.npm_config_chakra_e2e_only || null;

const shouldApplyRatchet = () => {
  const raw = getOnlyRaw();
  if (!raw) return true; // full run
  return String(raw).trim().toLowerCase() === 'default'; // old default subset still ratcheted
};

const ensurePrerequisites = () => {
  if (!fs.existsSync(fixtureRoot) || !fs.existsSync(path.join(fixtureRoot, 'package.json'))) {
    throw new Error('Chakra UI submodule missing. Run: git submodule update --init fixtures/chakra-ui');
  }
  if (!fs.existsSync(figmaCli)) {
    throw new Error('Figma CLI missing. Run npm install in the superconnect repo');
  }
};

const copyFixture = (dest) => {
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
    console.log(`$ ${[cmd].concat(args).join(' ')}`);
    if (output.trim()) console.log(output.trim());
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[cmd].concat(args).join(' ')}\n${output}`);
  }
  return output;
};

const shouldKeep = () => {
  const val = process.env.CHAKRA_E2E_KEEP || process.env.npm_config_chakra_e2e_keep;
  if (!val) return false;
  const normalized = String(val).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const maybeTest = RUN_E2E ? test : test.skip;

maybeTest('runs superconnect against Chakra UI and publishes cleanly (React)', () => {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakra-e2e-'));
  try {
    copyFixture(tmpDir);
    writeConfig(tmpDir);
    fs.removeSync(path.join(tmpDir, 'superconnect'));
    fs.removeSync(path.join(tmpDir, 'codeConnect'));

    const superconnectArgs = [superconnectScript, '--framework', 'react', '--force'];
    if (Array.isArray(subset) && subset.length > 0) {
      superconnectArgs.push('--only', subset.join(','));
    }
    run('node', superconnectArgs, { cwd: tmpDir, env });

    const outputDir = path.join(tmpDir, 'codeConnect');
    const connectors = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((file) => file.endsWith('.figma.tsx'))
      : [];
    expect(connectors.length).toBeGreaterThan(0);

    run(figmaCli, ['connect', 'parse'], { cwd: tmpDir, env });
    const publishOutput = run(figmaCli, ['connect', 'publish', '--dry-run'], {
      cwd: tmpDir,
      env
    });
    expect(publishOutput).toEqual(expect.stringContaining('All Code Connect files are valid'));

    const metrics = computeChakraBenchMetrics(tmpDir);
    expect(metrics.connectors).toBe(connectors.length);
    console.log(`CHAKRA_BENCH_METRICS: ${JSON.stringify(metrics)}`);

    if (shouldRecordBaseline()) {
      writeBaselineMetrics(metrics);
      console.log(`Recorded Chakra benchmark baseline at ${baselinePath}`);
    } else {
      if (!shouldApplyRatchet()) {
        console.log('Subset run detected; skipping Chakra benchmark ratchet');
      } else {
        const baseline = readBaselineMetrics();
        if (!baseline) {
          console.log(
            `No Chakra benchmark baseline found at ${baselinePath}. Run with CHAKRA_E2E_RECORD=1 to record`
          );
        } else {
          const { failures } = compareChakraBenchMetrics(baseline, metrics);
          if (failures.length > 0) {
            console.log(`Chakra benchmark regressions:\n${failures.join('\n')}`);
          }
          expect(failures).toEqual([]);
        }
      }
    }
  } finally {
    if (shouldKeep()) {
      console.log(`CHAKRA_E2E_KEEP set; leaving temp dir at ${tmpDir}`);
    } else {
      fs.removeSync(tmpDir);
    }
  }
});
