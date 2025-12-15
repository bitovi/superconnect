const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'react-enum-clamp');

describe.skip('codegen canonicalizes figma enum axes and clamps enum defaults (react)', () => {
  const runCodegen = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-enum-clamp-'));
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
      '--fake-mapping-output',
      path.join(superconnect, 'fake-mapping.json'),
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
    return { files, contents };
  };

  test('lowercases axis names, fixes colorPallete alias, clamps defaults', () => {
    const { files, contents } = runCodegen();
    expect(files).toEqual(['button.figma.tsx']);
    expect(contents).toContain("size: figma.enum('Size'");
    expect(contents).toContain("colorPalette: figma.enum('colorPallete'");
    expect(contents).toContain("example: ({ size = \"md\", colorPalette = \"blue\" } = {}) => (");
  });
});
