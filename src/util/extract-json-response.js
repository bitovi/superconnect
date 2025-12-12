const tryParseJson = (input) => {
  if (!input || typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const stripLineComments = (input) =>
  input
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '');

const stripTrailingCommas = (input) => input.replace(/,\s*([}\]])/g, '$1');

const maybeConvertSingleQuotes = (input) => {
  if (!input || input.includes('"')) return input;
  return input.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, body) => {
    const escaped = String(body).replace(/"/g, '\\"');
    return `"${escaped}"`;
  });
};

const tryParseJsonWithRepairs = (input) => {
  const direct = tryParseJson(input);
  if (direct) return direct;

  const noComments = stripLineComments(input || '');
  const noTrailing = stripTrailingCommas(noComments);
  const repaired = tryParseJson(noTrailing);
  if (repaired) return repaired;

  const singleQuoted = maybeConvertSingleQuotes(noTrailing);
  if (singleQuoted !== noTrailing) {
    const repairedSingle = tryParseJson(stripTrailingCommas(stripLineComments(singleQuoted)));
    if (repairedSingle) return repairedSingle;
  }

  return null;
};

const extractJsonResponse = (text) => {
  if (!text) return null;
  const trimmed = String(text).trim();

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    const fencedParsed = tryParseJsonWithRepairs(candidate);
    if (fencedParsed) return fencedParsed;
  }

  const wholeParsed = tryParseJsonWithRepairs(trimmed);
  if (wholeParsed) return wholeParsed;

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    return tryParseJsonWithRepairs(slice);
  }

  return null;
};

module.exports = {
  extractJsonResponse,
  tryParseJsonWithRepairs
};

