const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');

const runCodegenStub = (fixtureDir) => {
  const superconnect = path.join(fixtureDir, 'superconnect');
  const codeConnectDir = path.join(fixtureDir, 'codeConnect');
  fs.removeSync(codeConnectDir);
  const args = [
    codegenScript,
    '--figma-index',
    path.join(superconnect, 'figma-components-index.json'),
    '--orienter',
    path.join(superconnect, 'fake-orientation.jsonl'),
    '--repo-summary',
    path.join(superconnect, 'repo-summary.json'),
    '--target-framework',
    'angular',
    '--fake-mapping-output',
    path.join(superconnect, 'fake-mapping.json')
  ];
  execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: fixtureDir });
  return path.join(codeConnectDir, 'button.figma.ts');
};

describe('angular codegen stub', () => {
  test('writes a stub file with selector and html example', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const stubPath = runCodegenStub(fixtureDir);
    expect(fs.existsSync(stubPath)).toBe(true);
    const contents = fs.readFileSync(stubPath, 'utf8');
    expect(contents).toContain('figma.connect');
    expect(contents).toContain('html`');
    expect(contents).toMatch(/zap-button/);
    expect(contents).toContain("variant: figma.enum('variant', {\"primary\":\"primary\",\"secondary\":\"secondary\"})");
    expect(contents).toContain("options: figma.string('options'");
    expect(contents).toContain("[options]");
    expect(contents.toLowerCase()).toContain('example');
  });
});
