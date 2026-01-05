const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// 0.3.x: Orienter script removed (unified into codegen)
const orienterScript = path.join(__dirname, '..', 'scripts', 'archive', 'run-orienter-0.2.x.js');

const copyFixture = (fixtureDir) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-orienter-'));
  const superconnectSrc = path.join(fixtureDir, 'superconnect');
  const superconnectDest = path.join(tmpDir, 'superconnect');
  fs.ensureDirSync(superconnectDest);
  ['figma-components-index.json', 'fake-orientation.jsonl', 'repo-summary.json'].forEach((file) => {
    const src = path.join(superconnectSrc, file);
    const dest = path.join(superconnectDest, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  });
  return tmpDir;
};

const runOrienterFake = (fixtureDir) => {
  const output = path.join(fixtureDir, 'superconnect', 'orientation.jsonl');
  fs.removeSync(output);
  const repoSummaryPath = path.join(fixtureDir, 'superconnect', 'repo-summary.json');
  if (!fs.existsSync(repoSummaryPath)) {
    const stubSummary = {
      root: fixtureDir,
      frameworks: ['react'],
      primary_framework: 'react',
      angular_components: []
    };
    fs.writeJsonSync(repoSummaryPath, stubSummary, { spaces: 2 });
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
    'react',
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
describe.skip('react orienter with fake output', () => {
  test('writes orientation including the mapped React file', () => {
    const fixtureDir = copyFixture(path.join(__dirname, '..', 'fixtures', 'react-sample'));
    const { output, stdout } = runOrienterFake(fixtureDir);
    expect(fs.existsSync(output)).toBe(true);
    expect(stdout.toLowerCase()).toContain('fake orienter output');
    const entries = readOrientationLines(output);
    const entry = entries.find((e) => e.figma_component_name === 'FixtureComponent');
    expect(entry).toBeTruthy();
    expect(entry.files).toContain('src/App.tsx');
  });
});
