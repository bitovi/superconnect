const {
  extractFigmaStyleVariantKeys,
  mergePropHintsForRecipeStyle
} = require('../src/react/figma-style-variants');

describe('extractFigmaStyleVariantKeys', () => {
  test('keeps enum axes and drops boolean/dotted axes', () => {
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
    expect(keys.sort()).toEqual(['size', 'variant']);
  });

  test('drops pseudo-state axis names', () => {
    const componentJson = {
      data: {
        variantProperties: {
          state: ['default', 'disabled', 'focus'],
          size: ['sm', 'md']
        }
      }
    };
    const keys = extractFigmaStyleVariantKeys(componentJson);
    expect(keys).toEqual(['size']);
  });
});

describe('mergePropHintsForRecipeStyle', () => {
  test('unions figma style keys only when recipe-style', () => {
    const base = new Set(['children', 'onClick']);
    const componentJson = {
      data: { variantProperties: { size: ['sm', 'md'], variant: ['solid', 'outline'] } }
    };
    const recipeStyle = { isRecipeStyle: true };
    const merged = mergePropHintsForRecipeStyle(base, componentJson, recipeStyle);
    expect(Array.from(merged).sort()).toEqual(['children', 'onClick', 'size', 'variant']);

    const notRecipe = mergePropHintsForRecipeStyle(base, componentJson, { isRecipeStyle: false });
    expect(Array.from(notRecipe).sort()).toEqual(['children', 'onClick']);
  });
});

