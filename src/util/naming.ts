/**
 * Shared naming/string utilities used across scripts.
 * Consolidated here to avoid duplication.
 */

/**
 * Sanitize a string into a safe slug for filenames/identifiers.
 * @param value - Input string
 * @param fallback - Fallback if result is empty
 * @returns Sanitized slug
 */
export const sanitizeSlug = (value: string, fallback: string = 'component'): string => {
  const base = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
};

/**
 * Convert a component name to a Figma token placeholder.
 * Used in logs and outputs to reference Figma nodes.
 * @param value - Component or node name
 * @returns Figma token placeholder like <FIGMA_BUTTON>
 */
export const toTokenName = (value: string): string =>
  `<FIGMA_${(value || 'node')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}>`;

/**
 * Parse a string value to a positive integer, or return fallback.
 * @param value - Input to parse
 * @param fallback - Value to return if parsing fails
 * @returns Parsed number or fallback
 */
export const parseMaxTokens = (value: string | number | undefined, fallback?: number): number | undefined => {
  const parsed = value ? parseInt(String(value), 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
