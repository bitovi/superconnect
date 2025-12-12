const path = require('path');

// Evidence that a component uses a recipe/slot-recipe styling system.
// Kept intentionally narrow to avoid overfitting to Chakra.
const RECIPE_STYLE_PATH_RE = /(?:^|[\\/])(theme|styled-system|styles?)[\\/](recipes?|recipe)(?:[\\/]|$)/i;
const RECIPE_STYLE_CONTENT_RES = [
  /\bdefineSlotRecipe\s*\(/,
  /\bdefineRecipe\s*\(/,
  /\bcreateSlotRecipeContext\b/,
  /\bcreateRecipeContext\b/,
  /\bSlotRecipeProps\b/,
  /\bRecipeProps\b/
];

const normalizePathForMatch = (raw) => {
  if (!raw) return '';
  return raw.split(path.sep).join('/');
};

const detectRecipeStyleComponent = (files = []) => {
  if (!Array.isArray(files) || files.length === 0) {
    return { isRecipeStyle: false, evidence: null };
  }

  const paths = files
    .map((file) => normalizePathForMatch(file?.path))
    .filter(Boolean);

  const pathMatches = paths.filter((p) => RECIPE_STYLE_PATH_RE.test(p));

  const contentMatches = files.filter((file) => {
    if (typeof file?.content !== 'string') return false;
    return RECIPE_STYLE_CONTENT_RES.some((re) => re.test(file.content));
  });

  const isRecipeStyle = pathMatches.length > 0 || contentMatches.length > 0;

  return {
    isRecipeStyle,
    evidence: isRecipeStyle
      ? {
          pathCount: pathMatches.length,
          contentCount: contentMatches.length
        }
      : null
  };
};

module.exports = {
  detectRecipeStyleComponent,
  RECIPE_STYLE_PATH_RE,
  RECIPE_STYLE_CONTENT_RES
};

