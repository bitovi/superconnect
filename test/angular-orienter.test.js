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

describe('angular-aware orienter', () => {
  test('includes angular component file in orientation output', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const { output, stdout } = runOrienterFake(fixtureDir);
    expect(fs.existsSync(output)).toBe(true);
    expect(stdout.toLowerCase()).toContain('fake orienter output');
    const entries = readOrientationLines(output);
    const button = entries.find((e) => e.figma_component_name === 'Button');
    expect(button).toBeTruthy();
    expect(button.files).toContain('src/app/components/zap-button/zap-button.component.ts');
  });
});
