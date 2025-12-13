const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const codegenScript = path.join(__dirname, '..', 'scripts', 'run-codegen.js');
const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'react-hyphen');

describe('codegen handles hyphenated prop names (react)', () => {
  const runCodegen = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-hyphen-'));
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
      'Tabs.Trigger'
    ];
    execFileSync('node', args, { cwd: tmpDir, stdio: 'pipe' });
    const codeConnectDir = path.join(tmpDir, 'codeConnect');
    const files = fs.readdirSync(codeConnectDir).filter((f) => f.endsWith('.figma.tsx'));
    const contents = fs.readFileSync(path.join(codeConnectDir, files[0]), 'utf8');
    fs.removeSync(tmpDir);
    return { files, contents };
  };

  test('quotes hyphenated keys and uses safe identifiers', () => {
    const { files, contents } = runCodegen();
    expect(files).toEqual(['tabs_trigger.figma.tsx']);
    expect(contents).toContain("'data-selected': figma.boolean('.isSelected?')");
    expect(contents).toContain("example: ({ size = \"md\", 'data-selected': dataselected = false } = {}) => (");
    expect(contents).toContain('data-selected={dataselected}');
  });
});
