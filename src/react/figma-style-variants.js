const cleanPropName = (raw) => (raw || '').replace(/^['"`]/, '').replace(/['"`]$/, '').trim();

const sanitizePropKeyForMatch = (key) =>
  (key || '')
    .trim()
    .toLowerCase()
    .replace(/^[.]/, '')
    .replace(/[?]/g, '')
    .replace(/[^a-z0-9_]/g, '');

const BOOLEAN_VALUE_SETS = [
  new Set(['yes', 'no']),
  new Set(['true', 'false']),
  new Set(['on', 'off'])
];

const isBooleanAxis = (rawKey, values) => {
  const key = (rawKey || '').trim();
  if (key.startsWith('.') || key.includes('?')) return true;
  if (!Array.isArray(values)) return false;
  const normalizedValues = values
    .map((v) => String(v).toLowerCase().trim())
    .filter(Boolean);
  if (normalizedValues.length !== 2) return false;
  return BOOLEAN_VALUE_SETS.some((set) => normalizedValues.every((v) => set.has(v)));
};

const isPseudoStateAxis = (rawKey) => {
  const key = sanitizePropKeyForMatch(rawKey);
  return key === 'state' || key === 'interaction';
};

const extractFigmaStyleVariantKeys = (componentJson) => {
  const variantProps =
    componentJson?.data?.variantProperties ||
    componentJson?.variantProperties ||
    {};

  return Object.entries(variantProps)
    .filter(([rawKey, values]) => !isBooleanAxis(rawKey, values) && !isPseudoStateAxis(rawKey))
    .map(([rawKey]) =>
      cleanPropName(String(rawKey).replace(/^[.]/, '').replace(/[?]/g, ''))
    )
    .filter(Boolean);
};

const mergePropHintsForRecipeStyle = (propHints, componentJson, recipeStyle) => {
  const merged = new Set(propHints || []);
  if (!recipeStyle?.isRecipeStyle) return merged;
  const styleKeys = extractFigmaStyleVariantKeys(componentJson);
  styleKeys.forEach((key) => merged.add(key));
  return merged;
};

module.exports = {
  extractFigmaStyleVariantKeys,
  mergePropHintsForRecipeStyle,
  isBooleanAxis,
  isPseudoStateAxis
};

