const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  extractFigmaStyleVariantKeys,
  mergePropHintsForRecipeStyle
} = require('../src/react/figma-style-variants');

describe('extractFigmaStyleVariantKeys', () => {
  it('keeps enum axes and drops boolean/dotted axes', () => {
    const componentJson = {
      data: {
        variantProperties: {
          size: ['sm', 'md', 'lg'],
          variant: ['solid', 'outline'],
          '.isDisabled?': ['no', 'yes'],
          attached: ['yes', 'no']
        }
      }
    };
    const keys = extractFigmaStyleVariantKeys(componentJson);
    assert.deepStrictEqual(keys.sort(), ['size', 'variant']);
  });

  it('drops pseudo-state axis names', () => {
    const componentJson = {
      data: {
        variantProperties: {
          state: ['default', 'disabled', 'focus'],
          size: ['sm', 'md']
        }
      }
    };
    const keys = extractFigmaStyleVariantKeys(componentJson);
    assert.deepStrictEqual(keys, ['size']);
  });
});

describe('mergePropHintsForRecipeStyle', () => {
  it('drops pseudo-state enum axes lacking enum evidence', () => {
    const base = new Set(['size']);
    const componentJson = {
      data: { variantProperties: { state: ['default', 'hover'], size: ['sm', 'md'] } }
    };
    const merged = mergePropHintsForRecipeStyle(base, componentJson, { isRecipeStyle: true });
    assert.deepStrictEqual(Array.from(merged).sort(), ['size']);
  });

  it('unions figma style keys only when recipe-style', () => {
    const base = new Set(['children', 'onClick']);
    const componentJson = {
      data: { variantProperties: { size: ['sm', 'md'], variant: ['solid', 'outline'] } }
    };
    const recipeStyle = { isRecipeStyle: true };
    const merged = mergePropHintsForRecipeStyle(base, componentJson, recipeStyle);
    assert.deepStrictEqual(Array.from(merged).sort(), ['children', 'onClick', 'size', 'variant']);

    const notRecipe = mergePropHintsForRecipeStyle(base, componentJson, { isRecipeStyle: false });
    assert.deepStrictEqual(Array.from(notRecipe).sort(), ['children', 'onClick']);
  });
});
