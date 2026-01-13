const path = require('path');
const fg = require('fast-glob');
const { readFileSafe } = require('./fs-helpers');

const toPosix = (value) => value.replace(/\\/g, '/');

const extractSelector = (source) => {
  if (!source) return null;
  const match = source.match(/@Component\s*\(\s*{[^}]*selector\s*:\s*['"`]([^'"`]+)['"`]/s);
  return match ? match[1].trim() : null;
};

const extractClassName = (source) => {
  if (!source) return null;
  const match = source.match(/export\s+class\s+([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
};

const resolveHtmlFile = async (root, tsRelPath, source) => {
  const baseDir = path.dirname(tsRelPath);
  if (source) {
    const match = source.match(/templateUrl\s*:\s*['"`]([^'"`]+)['"`]/);
    if (match && match[1]) {
      const candidate = path.join(baseDir, match[1]);
      const exists = await readFileSafe(path.join(root, candidate));
      if (exists !== null) return toPosix(candidate);
    }
  }
  const inferred = tsRelPath.replace(/\.ts$/, '.html');
  const hasHtml = await readFileSafe(path.join(root, inferred));
  return hasHtml !== null ? toPosix(inferred) : null;
};

const loadModuleFiles = async (root, modulePaths) => {
  const contents = new Map();
  for (const rel of modulePaths) {
    // eslint-disable-next-line no-await-in-loop
    const text = await readFileSafe(path.join(root, rel));
    if (text) contents.set(rel, text);
  }
  return contents;
};

const findModuleForComponent = (className, moduleContents) => {
  if (!className) return null;
  for (const [relPath, content] of moduleContents.entries()) {
    const inDeclarations = new RegExp(`declarations\\s*:\\s*\\[[^\\]]*\\b${className}\\b`, 's');
    if (inDeclarations.test(content) || content.includes(className)) {
      return toPosix(relPath);
    }
  }
  return null;
};

const detectAngularComponents = async ({ root, ignore = [] } = {}) => {
  const componentFiles = await fg(['**/*.component.ts'], {
    cwd: root,
    ignore,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
  if (componentFiles.length === 0) return [];

  const moduleFiles = await fg(['**/*.module.ts'], {
    cwd: root,
    ignore,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
  const moduleContents = await loadModuleFiles(root, moduleFiles);

  const results = [];
  for (const relPath of componentFiles) {
    // eslint-disable-next-line no-await-in-loop
    const source = await readFileSafe(path.join(root, relPath));
    const selector = extractSelector(source);
    const className = extractClassName(source);
    const htmlFile = await resolveHtmlFile(root, relPath, source);
    const moduleFile = findModuleForComponent(className, moduleContents);
    if (!selector && !className) continue;
    results.push({
      selector: selector || null,
      class_name: className || null,
      ts_file: toPosix(relPath),
      html_file: htmlFile,
      module_file: moduleFile,
    });
  }
  return results;
};

module.exports = {
  detectAngularComponents,
};
