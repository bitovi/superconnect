/**
 * Shared naming/string utilities used across scripts.
 * Consolidated here to avoid duplication.
 */

/**
 * Sanitize a string into a safe slug for filenames/identifiers.
 * @param {string} value - Input string
 * @param {string} fallback - Fallback if result is empty
 * @returns {string}
 */
const sanitizeSlug = (value, fallback = 'component') => {
  const base = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
};

/**
 * Convert a component name to a Figma token placeholder.
 * Used in logs and outputs to reference Figma nodes.
 * @param {string} value - Component or node name
 * @returns {string}
 */
const toTokenName = (value) =>
  `<FIGMA_${(value || 'node')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}>`;

/**
 * Parse a string value to a positive integer, or return fallback.
 * @param {string|number} value - Input to parse
 * @param {number} [fallback] - Value to return if parsing fails
 * @returns {number|undefined}
 */
const parseMaxTokens = (value, fallback) => {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  sanitizeSlug,
  toTokenName,
  parseMaxTokens
};
