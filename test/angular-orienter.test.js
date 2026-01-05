const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// 0.3.x: Orienter script removed (unified into codegen)
const orienterScript = path.join(__dirname, '..', 'scripts', 'archive', 'run-orienter-0.2.x.js');

const copyFixture = (fixtureDir) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-orienter-'));
  fs.copySync(fixtureDir, tmpDir);
  const repoSummarySrc = path.join(fixtureDir, 'superconnect', 'repo-summary.json');
  const repoSummaryDest = path.join(tmpDir, 'superconnect', 'repo-summary.json');
  if (!fs.existsSync(repoSummaryDest) && fs.existsSync(repoSummarySrc)) {
    fs.copySync(repoSummarySrc, repoSummaryDest);
  }
  return tmpDir;
};

const runOrienterFake = (fixtureDir) => {
  const output = path.join(fixtureDir, 'superconnect', 'orientation.jsonl');
  fs.removeSync(output);
  const repoSummaryPath = path.join(fixtureDir, 'superconnect', 'repo-summary.json');
  if (!fs.existsSync(repoSummaryPath)) {
    fs.ensureDirSync(path.dirname(repoSummaryPath));
    fs.writeJsonSync(repoSummaryPath, {});
  }
  const args = [
    orienterScript,
    '--figma-index',
    path.join(fixtureDir, 'superconnect', 'figma-components-index.json'),
    '--repo-summary',
    repoSummaryPath,
    '--output',
    output,
    '--target-framework',
    'angular',
    '--fake-orienter-output',
    path.join(fixtureDir, 'superconnect', 'fake-orientation.jsonl')
  ];
  const result = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { output, stdout: result };
};

const readOrientationLines = (filePath) =>
  fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// 0.3.x: Orientation tests skipped (feature merged into unified codegen)
describe.skip('angular-aware orienter', () => {
  test('includes angular component file in orientation output', () => {
    const fixtureDir = copyFixture(path.join(__dirname, '..', 'fixtures', 'angular-sample'));
    const { output, stdout } = runOrienterFake(fixtureDir);
    expect(fs.existsSync(output)).toBe(true);
    expect(stdout.toLowerCase()).toContain('fake orienter output');
    const entries = readOrientationLines(output);
    const button = entries.find((e) => e.figma_component_name === 'Button');
    expect(button).toBeTruthy();
    expect(button.files).toContain('src/app/components/zap-button/zap-button.component.ts');
  });
});
