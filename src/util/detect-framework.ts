/**
 * Framework detection utilities for identifying React and Angular projects.
 */

import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import { readFileSafe } from './fs-helpers.ts';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface DetectOptions {
  root: string;
  packageJson?: PackageJson | null;
  ignore?: string[];
}

interface DetectResult {
  frameworks: string[];
  primaryFramework: string | null;
}

const hasDep = (pkg: PackageJson | null = null, names: string[] = []): boolean => {
  if (!pkg) return false;
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
  return names.some((name) => Object.prototype.hasOwnProperty.call(deps, name));
};

const detectAngular = async (root: string, pkg: PackageJson | null, ignore: string[]): Promise<string[]> => {
  const signals: string[] = [];
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

const fileHasReactImport = async (root: string, relPath: string): Promise<boolean> => {
  const full = path.join(root, relPath);
  const content = await readFileSafe(full);
  if (!content) return false;
  const trimmed = content.slice(0, 4000); // only the top of the file to keep it fast
  const reactImport = /\bfrom\s+['"]react['"]|require\(['"]react['"]\)|^import\s+React\b/m;
  return reactImport.test(trimmed);
};

const detectReact = async (root: string, pkg: PackageJson | null, ignore: string[]): Promise<string[]> => {
  const signals: string[] = [];
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

export const detectFrameworks = async ({ root, packageJson = null, ignore = [] }: DetectOptions): Promise<DetectResult> => {
  const frameworks: string[] = [];

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
