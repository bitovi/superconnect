const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const summarizeScript = path.join(__dirname, '..', 'scripts', 'summarize-repo.js');

const runSummary = (root) => {
  const output = path.join(root, 'superconnect', 'repo-summary.json');
  fs.removeSync(output);
  fs.ensureDirSync(path.dirname(output));
  execFileSync('node', [summarizeScript, '--root', root], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const fileData = fs.readJsonSync(output);
  return { parsed: fileData, fileData };
};

describe('angular component discovery', () => {
  test('captures selector, class, and related files', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const { parsed } = runSummary(root);
    expect(Array.isArray(parsed.angular_components)).toBe(true);
    const match = parsed.angular_components.find((c) => c.selector === 'zap-button');
    expect(match).toBeTruthy();
    expect(match.class_name).toBe('ZapButtonComponent');
    expect(match.ts_file).toBe('src/app/components/zap-button/zap-button.component.ts');
    expect(match.html_file).toBe('src/app/components/zap-button/zap-button.component.html');
    expect(match.module_file).toBe('src/app/app.module.ts');
  });
});
