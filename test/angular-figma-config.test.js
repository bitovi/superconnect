const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const finalizeScript = path.join(__dirname, '..', 'scripts', 'finalize.js');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');

describe('angular figma config', () => {
  const runFinalize = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-angular-'));
    fs.copySync(fixtureDir, tmpDir);
    execFileSync('node', [finalizeScript, '--cwd', tmpDir, '--target-framework', 'angular'], {
      cwd: tmpDir,
      stdio: 'ignore'
    });
    const configPath = path.join(tmpDir, 'figma.config.json');
    const config = fs.readJsonSync(configPath);
    fs.removeSync(tmpDir);
    return config;
  };

  test('sets html parser and angular include glob', () => {
    const config = runFinalize();
    expect(config.codeConnect.parser).toBe('html');
    expect(config.codeConnect.include).toEqual(
      expect.arrayContaining(['codeConnect/**/*.figma.ts'])
    );
  });
});
