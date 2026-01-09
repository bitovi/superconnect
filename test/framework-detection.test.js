const { describe, it } = require('node:test');
const assert = require('node:assert');
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
  it('detects React in fixture repo', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const { parsed, fileData } = runSummary(root);
    assert.ok(parsed.frameworks.includes('react'));
    assert.strictEqual(parsed.primary_framework, 'react');
    assert.ok(fileData.frameworks.includes('react'));
    assert.strictEqual(fileData.primary_framework, 'react');
    assert.ok(!parsed.frameworks.includes('angular'));
  });

  it('detects Angular in zapui repo', () => {
    const root = path.resolve(__dirname, '..', '..', 'zapui');
    if (!fs.existsSync(root)) return;
    const tempOutput = path.join(__dirname, '..', 'tmp', 'zapui-repo-summary.json');
    const { parsed, fileData } = runSummary(root, tempOutput);
    assert.ok(parsed.frameworks.includes('angular'));
    assert.strictEqual(parsed.primary_framework, 'angular');
    assert.ok(fileData.frameworks.includes('angular'));
    assert.strictEqual(fileData.primary_framework, 'angular');
  });
});
