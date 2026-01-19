/**
 * Unit tests for import_from configuration feature.
 * 
 * Verifies that when import_from is specified in superconnect.toml,
 * the generated Code Connect files use package imports instead of relative paths.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import buildSystemPrompt from React direct-codegen
// Note: This is a workaround since buildSystemPrompt is not exported
// In production, the function is called internally by processComponent
async function getReactSystemPrompt(importFrom?: string | null): Promise<string> {
  const modulePath = path.join(__dirname, '../src/react/direct-codegen.ts');
  const module = await import(modulePath);
  // Access the private function via module namespace
  const buildSystemPrompt = (module as any).buildSystemPrompt;
  if (!buildSystemPrompt) {
    throw new Error('buildSystemPrompt not found in react/direct-codegen module');
  }
  return buildSystemPrompt(false, importFrom);
}

async function getAngularSystemPrompt(importFrom?: string | null): Promise<string> {
  const modulePath = path.join(__dirname, '../src/angular/direct-codegen.ts');
  const module = await import(modulePath);
  const buildSystemPrompt = (module as any).buildSystemPrompt;
  if (!buildSystemPrompt) {
    throw new Error('buildSystemPrompt not found in angular/direct-codegen module');
  }
  return buildSystemPrompt(false, importFrom);
}

describe('import_from configuration', () => {
  describe('React direct-codegen', () => {
    it('should inject package import instructions when import_from is provided', async () => {
      const systemPrompt = await getReactSystemPrompt('@my-org/design-system');
      
      // Should contain the package name in import instructions
      assert.ok(systemPrompt.includes('@my-org/design-system'), 'Should contain package name');
      assert.ok(systemPrompt.includes('import { ComponentName } from "@my-org/design-system"'), 'Should show import example');
      assert.ok(systemPrompt.includes('Do NOT use relative paths or internal monorepo paths'), 'Should warn against relative paths');
      
      // Should NOT contain the placeholder
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });

    it('should use fallback instructions when import_from is not provided', async () => {
      const systemPrompt = await getReactSystemPrompt(null);
      
      // Should contain fallback guidance
      assert.ok(systemPrompt.includes('Use the import paths from the source files provided'), 'Should contain fallback guidance');
      assert.ok(systemPrompt.includes('Prefer package-based imports'), 'Should mention package-based imports');
      
      // Should NOT contain the placeholder
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });

    it('should use fallback instructions when import_from is empty string', async () => {
      const systemPrompt = await getReactSystemPrompt('');
      
      // Empty string is falsy, so should use fallback
      assert.ok(systemPrompt.includes('Use the import paths from the source files provided'), 'Should contain fallback guidance');
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });
  });

  describe('Angular direct-codegen', () => {
    it('should inject package import instructions when import_from is provided', async () => {
      const systemPrompt = await getAngularSystemPrompt('@my-org/design-system');
      
      // Should contain the package name in import instructions
      assert.ok(systemPrompt.includes('@my-org/design-system'), 'Should contain package name');
      assert.ok(systemPrompt.includes("import { Button } from '@my-org/design-system'"), 'Should show import example');
      assert.ok(systemPrompt.includes('always use **`@my-org/design-system`** as the import source'), 'Should emphasize package imports');
      assert.ok(systemPrompt.includes('Do NOT use relative paths'), 'Should warn against relative paths');
      
      // Should NOT contain the placeholder
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });

    it('should use fallback instructions when import_from is not provided', async () => {
      const systemPrompt = await getAngularSystemPrompt(null);
      
      // Should contain fallback guidance
      assert.ok(systemPrompt.includes('Use the import paths from the source files provided'), 'Should contain fallback guidance');
      assert.ok(systemPrompt.includes('Prefer package-based imports'), 'Should mention package-based imports');
      
      // Should NOT contain the placeholder
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });

    it('should use fallback instructions when import_from is empty string', async () => {
      const systemPrompt = await getAngularSystemPrompt('');
      
      // Empty string is falsy, so should use fallback
      assert.ok(systemPrompt.includes('Use the import paths from the source files provided'), 'Should contain fallback guidance');
      assert.ok(!systemPrompt.includes('{{IMPORT_INSTRUCTIONS}}'), 'Should not contain placeholder');
    });
  });

  describe('Prompt placeholder verification', () => {
    it('React prompt template should contain {{IMPORT_INSTRUCTIONS}} placeholder', () => {
      const promptPath = path.join(__dirname, '..', 'prompts', 'react-direct-codegen.md');
      const promptContent = fs.readFileSync(promptPath, 'utf8');
      
      assert.ok(promptContent.includes('{{IMPORT_INSTRUCTIONS}}'), 'React prompt should contain placeholder');
    });

    it('Angular prompt template should contain {{IMPORT_INSTRUCTIONS}} placeholder', () => {
      const promptPath = path.join(__dirname, '..', 'prompts', 'angular-direct-codegen.md');
      const promptContent = fs.readFileSync(promptPath, 'utf8');
      
      assert.ok(promptContent.includes('{{IMPORT_INSTRUCTIONS}}'), 'Angular prompt should contain placeholder');
    });
  });
});
