const { detectRecipeStyleComponent } = require('../src/util/recipe-style');

describe('detectRecipeStyleComponent', () => {
  test('detects recipe style from recipe-like paths', () => {
    const files = [
      { path: 'src/theme/recipes/button.ts', content: 'export const buttonRecipe = {}' },
      { path: 'src/components/button/button.tsx', content: 'export const Button = () => null' }
    ];
    const result = detectRecipeStyleComponent(files);
    expect(result.isRecipeStyle).toBe(true);
    expect(result.evidence?.pathCount).toBeGreaterThan(0);
  });

  test('detects recipe style from content patterns', () => {
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
    expect(result.isRecipeStyle).toBe(true);
    expect(result.evidence?.contentCount).toBeGreaterThan(0);
  });

  test('returns false when no evidence is present', () => {
    const files = [
      { path: 'src/components/button/button.tsx', content: 'export const Button = () => null' }
    ];
    const result = detectRecipeStyleComponent(files);
    expect(result.isRecipeStyle).toBe(false);
    expect(result.evidence).toBeNull();
  });
});

