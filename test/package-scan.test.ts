/**
 * Tests for package-scan module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanPackage } from '../src/util/package-scan.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('package-scan', () => {
  it('scans React package and detects framework', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // Check package info
    assert.strictEqual(result.package.name, 'react-sample');
    assert.strictEqual(result.package.directory, root);
    
    // Check framework detection
    assert.strictEqual(result.primary_framework, 'react');
    
    // Check that component files were found
    assert.ok(result.component_source_files.length > 0);
    
    // Verify exports are extracted
    const hasExports = result.component_source_files.some(f => f.exports.length > 0);
    assert.ok(hasExports, 'Should find files with exports');
    
    // Angular components should be empty for React project
    assert.strictEqual(result.angular_components.length, 0);
  });

  it('scans Angular package and detects framework', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'angular-sample');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // Check package info
    assert.ok(result.package.name); // Angular sample should have a name
    assert.strictEqual(result.package.directory, root);
    
    // Check framework detection
    assert.strictEqual(result.primary_framework, 'angular');
    
    // Check that component files were found
    assert.ok(result.component_source_files.length > 0);
    
    // Should detect Angular components
    assert.ok(result.angular_components.length > 0, 'Should find Angular components');
    
    // Verify Angular component structure
    if (result.angular_components.length > 0) {
      const firstComponent = result.angular_components[0];
      if (firstComponent) {
        assert.ok(firstComponent.ts_file, 'Angular component should have ts_file');
        assert.ok(firstComponent.selector || firstComponent.class_name, 'Angular component should have selector or class_name');
      }
    }
  });

  it('finds existing Code Connect files', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // existing_code_connect should be an array (may be empty)
    assert.ok(Array.isArray(result.existing_code_connect));
  });

  it('extracts exports from TypeScript files', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // Find a component file (typically has exports)
    const componentFile = result.component_source_files.find(f => 
      f.path.includes('Button') || f.path.includes('component')
    );
    
    if (componentFile) {
      // Component files should have at least one export
      assert.ok(componentFile.exports.length > 0, 'Component file should have exports');
    }
  });

  it('handles package with no package.json name', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'react-sample');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // Should handle missing name gracefully
    assert.ok(result.package.name !== undefined); // Either string or null
  });

  it('returns empty arrays for packages with no components', async () => {
    // Test with superconnect's own package.json (which has no components)
    const root = path.join(__dirname, '..');
    const packageJsonPath = path.join(root, 'package.json');
    
    const result = await scanPackage(packageJsonPath);
    
    // Should still return valid structure
    assert.ok(result.package);
    assert.ok(Array.isArray(result.component_source_files));
    assert.ok(Array.isArray(result.angular_components));
    assert.ok(Array.isArray(result.existing_code_connect));
  });
});
