const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const summarizeScript = path.join(__dirname, '..', 'scripts', 'summarize-repo.js');

const runSummary = (root, outputFile) => {
  const output = outputFile || path.join(root, 'superconnect-logs', 'repo-summary.json');
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
  it('detects React in react-sample fixture', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const { parsed } = runSummary(root);
    assert.ok(parsed.frameworks.includes('react'));
    assert.strictEqual(parsed.primary_framework, 'react');
    assert.ok(!parsed.frameworks.includes('angular'));
  });

  it('detects Angular in angular-sample fixture', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const { parsed } = runSummary(root);
    assert.ok(parsed.frameworks.includes('angular'));
    assert.strictEqual(parsed.primary_framework, 'angular');
    assert.ok(!parsed.frameworks.includes('react'));
  });
});
