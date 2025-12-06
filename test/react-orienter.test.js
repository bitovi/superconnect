const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const orienterScript = path.join(__dirname, '..', 'scripts', 'run-orienter.js');

const runOrienterFake = (fixtureDir) => {
  const output = path.join(fixtureDir, 'superconnect', 'orientation.jsonl');
  fs.removeSync(output);
  const args = [
    orienterScript,
    '--figma-index',
    path.join(fixtureDir, 'superconnect', 'figma-components-index.json'),
    '--repo-summary',
    path.join(fixtureDir, 'superconnect', 'repo-summary.json'),
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

describe('react orienter with fake output', () => {
  test('writes orientation including the mapped React file', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const { output, stdout } = runOrienterFake(fixtureDir);
    expect(fs.existsSync(output)).toBe(true);
    expect(stdout.toLowerCase()).toContain('fake orienter output');
    const entries = readOrientationLines(output);
    const entry = entries.find((e) => e.figma_component_name === 'FixtureComponent');
    expect(entry).toBeTruthy();
    expect(entry.files).toContain('src/App.tsx');
  });
});
