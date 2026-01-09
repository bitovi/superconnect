const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const finalizeScript = path.join(__dirname, '..', 'scripts', 'finalize.js');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'angular-sample');

describe('angular figma config', () => {
  const runFinalize = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-angular-'));
    fs.copySync(fixtureDir, tmpDir, {
      dereference: true,
      filter: (src) => !src.endsWith(`${path.sep}repo-summary.json`)
    });
    const repoSummarySrc = path.join(fixtureDir, 'superconnect', 'repo-summary.json');
    const repoSummaryDest = path.join(tmpDir, 'superconnect', 'repo-summary.json');
    if (fs.existsSync(repoSummarySrc)) {
      fs.ensureDirSync(path.dirname(repoSummaryDest));
      fs.writeFileSync(repoSummaryDest, fs.readFileSync(repoSummarySrc));
    }
    execFileSync('node', [finalizeScript, '--cwd', tmpDir, '--target-framework', 'angular'], {
      cwd: tmpDir,
      stdio: 'ignore'
    });
    const configPath = path.join(tmpDir, 'figma.config.json');
    const config = fs.readJsonSync(configPath);
    fs.removeSync(tmpDir);
    return config;
  };

  it('sets html parser and angular include glob', () => {
    const config = runFinalize();
    assert.strictEqual(config.codeConnect.parser, 'html');
    assert.ok(config.codeConnect.include.includes('codeConnect/**/*.figma.ts'));
  });
});
