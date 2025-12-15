const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const runCodegen = () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'chakra-button');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo-state-'));
  fs.copySync(fixtureDir, tmpDir);
  const args = [
    path.join(__dirname, '..', 'scripts', 'run-codegen.js'),
    '--figma-index',
    path.join(tmpDir, 'superconnect', 'figma-components-index.json'),
    '--orienter',
    path.join(tmpDir, 'superconnect', 'orientation.jsonl'),
    '--repo-summary',
    path.join(tmpDir, 'superconnect', 'repo-summary.json'),
    '--fake-mapping-output',
    path.join(tmpDir, 'superconnect', 'fake-mapping.json'),
    '--target-framework',
    'react',
    '--force',
    '--only',
    'Button'
  ];
  execFileSync('node', args, { cwd: tmpDir, stdio: 'pipe' });
  const codeConnectDir = path.join(tmpDir, 'codeConnect');
  const files = fs.readdirSync(codeConnectDir).filter((f) => f.endsWith('.figma.tsx'));
  const contents = fs.readFileSync(path.join(codeConnectDir, files[0]), 'utf8');
  fs.removeSync(tmpDir);
  return contents;
};

describe.skip('pseudo-state enum handling', () => {
  test('keeps figma enum axis and drops boolean remap for state', () => {
    const contents = runCodegen();
    expect(contents).toContain("figma.enum('state', { 'default': 'default', 'hover': 'hover' })");
    expect(contents).not.toContain("figma.boolean('state'");
  });
});
