const fs = require('fs-extra');
const path = require('path');

const readJsonSafeSync = (filePath) => {
  try {
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
};

const listFilesSafeSync = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
};

const countRegexMatches = (content, regex) => {
  if (!content) return 0;
  const matches = content.match(regex);
  return matches ? matches.length : 0;
};

const extractImportPaths = (content) => {
  if (!content) return [];
  const paths = [];
  const re = /\bfrom\s+['"]([^'"]+)['"]/g;
  let match = re.exec(content);
  while (match) {
    paths.push(match[1]);
    match = re.exec(content);
  }
  return paths;
};

const isInternalImportPath = (importPath) => {
  if (!importPath) return false;
  const normalized = String(importPath);
  if (normalized.startsWith('.') || normalized.startsWith('/')) return true;
  if (normalized.includes('packages/react/src')) return true;
  if (normalized.startsWith('packages/')) return true;
  return false;
};

const extractFigmaTokens = (content) => {
  if (!content) return [];
  return content.match(/<FIGMA_[A-Z0-9_]+>/g) || [];
};

const computeChakraBenchMetrics = (repoRoot) => {
  const superconnectDir = path.join(repoRoot, 'superconnect');
  const codegenLogsDir = path.join(superconnectDir, 'codegen-logs');
  const codeConnectDir = path.join(repoRoot, 'codeConnect');
  const figmaConfigPath = path.join(repoRoot, 'figma.config.json');

  const codegenLogs = listFilesSafeSync(codegenLogsDir).filter((file) =>
    file.endsWith('-codegen-result.json')
  );
  const summaries = codegenLogs
    .map(readJsonSafeSync)
    .filter(Boolean);

  const built = summaries.filter((s) => s.status === 'built').length;
  const skipped = summaries.filter((s) => s.status === 'skipped').length;
  const error = summaries.filter((s) => s.status === 'error').length;
  const invalidJson = summaries.filter((s) =>
    typeof s.reason === 'string' && s.reason.toLowerCase().includes('not valid json')
  ).length;

  const connectorFiles = listFilesSafeSync(codeConnectDir).filter((file) =>
    file.endsWith('.figma.tsx')
  );
  const connectorContents = connectorFiles.map((file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  });

  const internalImports = connectorContents.reduce((acc, content) => {
    const importPaths = extractImportPaths(content);
    return acc + importPaths.filter(isInternalImportPath).length;
  }, 0);

  const stateEnumProps = connectorContents.reduce(
    (acc, content) => acc + countRegexMatches(content, /figma\.enum\(['"]state['"]/g),
    0
  );
  const dottedAxisProps = connectorContents.reduce(
    (acc, content) => acc + countRegexMatches(content, /figma\.(?:enum|boolean)\(['"]\.[^'"]+['"]/g),
    0
  );

  const tokensUsed = connectorContents.flatMap(extractFigmaTokens);
  const uniqueTokensUsed = Array.from(new Set(tokensUsed));
  const figmaConfig = readJsonSafeSync(figmaConfigPath);
  const substitutions =
    figmaConfig?.codeConnect?.documentUrlSubstitutions ||
    figmaConfig?.documentUrlSubstitutions ||
    {};
  const missingTokens = uniqueTokensUsed.filter((token) => !substitutions[token]);

  return {
    built,
    skipped,
    error,
    invalidJson,
    connectors: connectorFiles.length,
    internalImports,
    stateEnumProps,
    dottedAxisProps,
    placeholderTokensUsed: uniqueTokensUsed.length,
    placeholderTokensMissing: missingTokens.length,
    missingTokens
  };
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const compareChakraBenchMetrics = (baseline, current) => {
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const curr = current && typeof current === 'object' ? current : {};

  const checks = [
    { key: 'built', direction: 'gte' },
    { key: 'connectors', direction: 'gte' },
    { key: 'invalidJson', direction: 'lte' },
    { key: 'internalImports', direction: 'lte' },
    { key: 'stateEnumProps', direction: 'lte' },
    { key: 'dottedAxisProps', direction: 'lte' },
    { key: 'placeholderTokensMissing', direction: 'lte' },
    { key: 'error', direction: 'lte' }
  ];

  const failures = checks.flatMap((check) => {
    const baselineValue = base[check.key];
    const currentValue = curr[check.key];
    if (!isNumber(baselineValue) || !isNumber(currentValue)) return [];

    const passed =
      check.direction === 'gte'
        ? currentValue >= baselineValue
        : currentValue <= baselineValue;

    if (passed) return [];

    const op = check.direction === 'gte' ? '>=' : '<=';
    return [
      `${check.key} regressed: expected ${op} ${baselineValue}, got ${currentValue}`
    ];
  });

  return { failures, checks };
};

module.exports = {
  computeChakraBenchMetrics,
  compareChakraBenchMetrics,
  isInternalImportPath,
  extractImportPaths,
  extractFigmaTokens
};
