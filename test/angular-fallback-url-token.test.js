const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const finalizeScript = path.join(__dirname, '..', 'scripts', 'finalize.js');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');

describe('angular figma.config include/filter', () => {
  const runFinalize = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-finalize-'));
    fs.copySync(fixtureDir, tmpDir);
    execFileSync('node', [finalizeScript, '--cwd', tmpDir, '--target-framework', 'angular'], {
      cwd: tmpDir,
      stdio: 'ignore'
    });
    const config = fs.readJsonSync(path.join(tmpDir, 'figma.config.json'));
    fs.removeSync(tmpDir);
    return config.codeConnect;
  };

  test('includes only angular codeConnect glob and sets html parser', () => {
    const codeConnect = runFinalize();
    expect(codeConnect.parser).toBe('html');
    expect(codeConnect.include).toEqual(expect.arrayContaining(['codeConnect/**/*.figma.ts']));
    expect(codeConnect.include).not.toEqual(expect.arrayContaining(['codeConnect/**/*.figma.tsx']));
  });
});
