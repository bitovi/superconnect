const fs = require('fs/promises');
const path = require('path');
const fg = require('fast-glob');

const readTextIfExists = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

const hasDep = (pkg = null, names = []) => {
  if (!pkg) return false;
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
  return names.some((name) => Object.prototype.hasOwnProperty.call(deps, name));
};

const detectAngular = async (root, pkg, ignore) => {
  const signals = [];
  const angularJson = path.join(root, 'angular.json');
  try {
    await fs.access(angularJson);
    signals.push('angular.json');
  } catch {
    // ignore
  }
  if (hasDep(pkg, ['@angular/core'])) {
    signals.push('package:@angular/core');
  }
  const matches = await fg(['src/app/**/*.component.ts', 'src/app/app.module.ts'], {
    cwd: root,
    ignore,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
  if (matches.length > 0) {
    signals.push('src/app components');
  }
  return signals;
};

const fileHasReactImport = async (root, relPath) => {
  const full = path.join(root, relPath);
  const content = await readTextIfExists(full);
  if (!content) return false;
  const trimmed = content.slice(0, 4000); // only the top of the file to keep it fast
  const reactImport = /\bfrom\s+['"]react['"]|require\(['"]react['"]\)|^import\s+React\b/m;
  return reactImport.test(trimmed);
};

const detectReact = async (root, pkg, ignore) => {
  const signals = [];
  if (hasDep(pkg, ['react', 'react-dom'])) {
    signals.push('package:react');
  }
  const candidates = await fg(['**/*.{tsx,jsx}'], {
    cwd: root,
    ignore,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
  const limited = candidates.slice(0, 50);
  for (const file of limited) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileHasReactImport(root, file)) {
      signals.push(`import-react:${file}`);
      break;
    }
  }
  return signals;
};

const detectFrameworks = async ({ root, packageJson = null, ignore = [] } = {}) => {
  const frameworks = [];

  const angularSignals = await detectAngular(root, packageJson, ignore);
  if (angularSignals.length > 0) frameworks.push('angular');

  const reactSignals = await detectReact(root, packageJson, ignore);
  if (reactSignals.length > 0) frameworks.push('react');

  const primaryFramework =
    frameworks.length === 1 ? frameworks[0] : frameworks.includes('react') ? 'react' : null;

  return {
    frameworks,
    primaryFramework,
  };
};

module.exports = {
  detectFrameworks,
};
