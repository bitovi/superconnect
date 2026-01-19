import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanPackage } from '../src/util/package-scan.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('framework detection', () => {
  it('detects React in react-sample fixture', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const packageJsonPath = path.join(root, 'package.json');
    const result = await scanPackage(packageJsonPath);
    assert.strictEqual(result.primary_framework, 'react');
    assert.strictEqual(result.angular_components.length, 0);
  });

  it('detects Angular in angular-sample fixture', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const packageJsonPath = path.join(root, 'package.json');
    const result = await scanPackage(packageJsonPath);
    assert.strictEqual(result.primary_framework, 'angular');
    assert.ok(result.angular_components.length > 0);
  });
});
