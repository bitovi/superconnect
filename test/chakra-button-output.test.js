const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'chakra-button');

describe.skip('codegen produces consumer-like Chakra Button output (react)', () => {
  const runCodegen = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakra-button-'));
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

  test('uses children text and left/right icons, drops unknown props', () => {
    const { files, contents } = runCodegen();
    expect(files).toEqual(['button.figma.tsx']);
    expect(contents).toContain("children: figma.string('label')");
    expect(contents).toContain("leftIcon: figma.instance('iconStart')");
    expect(contents).toContain("rightIcon: figma.instance('iconEnd')");
    expect(contents).toContain('leftIcon={leftIcon}');
    expect(contents).toContain('rightIcon={rightIcon}');
    expect(contents).toContain('>{children}</Button>');
    expect(contents).not.toContain('ghostProp');
    expect(contents).toContain("state: figma.enum('state'");
  });
});
