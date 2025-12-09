const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const summarizeScript = path.join(__dirname, '..', 'scripts', 'summarize-repo.js');

const runSummary = (root, outputFile) => {
  const output = outputFile || path.join(root, 'superconnect', 'repo-summary.json');
  fs.removeSync(output);
  fs.ensureDirSync(path.dirname(output));
  execFileSync('node', [summarizeScript, '--root', root, '--output', output], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const fileData = fs.readJsonSync(output);
  return { parsed: fileData, fileData };
};

describe('framework detection', () => {
  test('detects React in fixture repo', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const { parsed, fileData } = runSummary(root);
    expect(parsed.frameworks).toContain('react');
    expect(parsed.primary_framework).toBe('react');
    expect(fileData.frameworks).toContain('react');
    expect(fileData.primary_framework).toBe('react');
    expect(parsed.frameworks).not.toContain('angular');
  });

  test('detects Angular in zapui repo', () => {
    const root = path.resolve(__dirname, '..', '..', 'zapui');
    if (!fs.existsSync(root)) return;
    const tempOutput = path.join(__dirname, '..', 'tmp', 'zapui-repo-summary.json');
    const { parsed, fileData } = runSummary(root, tempOutput);
    expect(parsed.frameworks).toContain('angular');
    expect(parsed.primary_framework).toBe('angular');
    expect(fileData.frameworks).toContain('angular');
    expect(fileData.primary_framework).toBe('angular');
  });
});
