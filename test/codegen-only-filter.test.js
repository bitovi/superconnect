const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'only-filter');

describe('codegen --only filtering', () => {
  const runCodegen = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'only-filter-'));
    fs.copySync(fixtureRoot, tmpDir);
    const superconnect = path.join(tmpDir, 'superconnect');
    const args = [
      codegenScript,
      '--figma-index',
      path.join(superconnect, 'figma-components-index.json'),
      '--orienter',
      path.join(superconnect, 'orientation.jsonl'),
      '--repo-summary',
      path.join(superconnect, 'repo-summary.json'),
      '--target-framework',
      'angular',
      '--fake-mapping-output',
      path.join(superconnect, 'fake-mapping.json'),
      '--force',
      '--only',
      'Button, Alert'
    ];
    execFileSync('node', args, { cwd: tmpDir, stdio: 'pipe' });
    const codeConnectDir = path.join(tmpDir, 'codeConnect');
    const files = fs.readdirSync(codeConnectDir).filter((f) => f.endsWith('.figma.ts'));
    fs.removeSync(tmpDir);
    return files;
  };

  test('honors multiple --only values even when separated by comma + space', () => {
    const files = runCodegen();
    expect(files).toEqual(expect.arrayContaining(['button.figma.ts', 'alert.figma.ts']));
    expect(files.length).toBe(2);
  });
});
