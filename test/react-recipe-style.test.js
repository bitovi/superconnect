const { describe, it } = require('node:test');
const assert = require('node:assert');
const { detectRecipeStyleComponent } = require('../src/react/recipe-style');

describe('detectRecipeStyleComponent', () => {
  it('detects recipe style from recipe-like paths', () => {
    const files = [
      { path: 'src/theme/recipes/button.ts', content: 'export const buttonRecipe = {}' },
      { path: 'src/components/button/button.tsx', content: 'export const Button = () => null' }
    ];
    const result = detectRecipeStyleComponent(files);
    assert.strictEqual(result.isRecipeStyle, true);
    assert.ok(result.evidence?.pathCount > 0);
  });

  it('detects recipe style from content patterns', () => {
    const files = [
      {
        path: 'src/components/steps/steps.tsx',
        content: `
          import { defineSlotRecipe } from "../styled-system";
          export const stepsSlotRecipe = defineSlotRecipe({ variants: {} });
        `
      }
    ];
    const result = detectRecipeStyleComponent(files);
    assert.strictEqual(result.isRecipeStyle, true);
    assert.ok(result.evidence?.contentCount > 0);
  });

  it('returns false when no evidence is present', () => {
    const files = [
      { path: 'src/components/button/button.tsx', content: 'export const Button = () => null' }
    ];
    const result = detectRecipeStyleComponent(files);
    assert.strictEqual(result.isRecipeStyle, false);
    assert.strictEqual(result.evidence, null);
  });
});

