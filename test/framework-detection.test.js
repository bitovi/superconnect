import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const summarizeScript = path.join(__dirname, '..', 'scripts', 'summarize-repo.ts');
const runSummary = (root, outputFile) => {
  const output = outputFile || path.join(root, 'superconnect-logs', 'repo-summary.json');
  fs.removeSync(output);
  fs.ensureDirSync(path.dirname(output));
  execFileSync('node', ['--experimental-strip-types', summarizeScript, '--root', root, '--output', output], {
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
