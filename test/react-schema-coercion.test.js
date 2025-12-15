const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'react-coercion');

describe.skip('codegen coerces schema props to API surface (react)', () => {
  const runCodegen = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-coercion-'));
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

  test('renames icon and state props when targets exist', () => {
    const { files, contents } = runCodegen();
    expect(files).toEqual(['button.figma.tsx']);
    expect(contents).toContain("leftIcon: figma.instance('iconStart')");
    expect(contents).toContain("rightIcon: figma.instance('iconEnd')");
    expect(contents).toContain("isDisabled: figma.boolean('state')");
    expect(contents).toContain('leftIcon={leftIcon}');
    expect(contents).toContain('rightIcon={rightIcon}');
    expect(contents).toContain('isDisabled={isDisabled}');
    expect(contents).not.toContain('iconStart={');
    expect(contents).not.toContain('iconEnd={');
  });
});

