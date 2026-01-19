/**
 * Package scanning utilities for analyzing a single package's components.
 * 
 * This module provides focused scanning of a package directory to extract:
 * - Component source files and their exports
 * - Framework detection (React vs Angular)
 * - Angular component metadata
 * - Existing Code Connect files
 * 
 * @module package-scan
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { parse } from '@typescript-eslint/typescript-estree';
import { detectFrameworks } from './detect-framework.ts';
import { detectAngularComponents } from './scan-angular.ts';
import { readJsonSafe } from './fs-helpers.ts';

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/.next/**',
  '**/out/**',
  '**/storybook-static/**',
  '**/codeConnect/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/__generated__/**',
  '**/generated/**'
];

export interface AngularComponent {
  selector: string | null;
  class_name: string | null;
  ts_file: string;
  html_file: string | null;
  module_file: string | null;
}

export interface PackageScanResult {
  package: { 
    path: string; 
    name: string | null; 
    directory: string;
  };
  primary_framework: "react" | "angular" | null;
  component_source_files: Array<{ path: string; exports: string[] }>;
  angular_components: AngularComponent[];
  existing_code_connect: string[];
}

/**
 * Extract exported identifiers from TypeScript/TSX source code using AST parsing.
 * Handles named exports, default exports, and export declarations.
 * Silently returns empty array on parse errors to prevent crashing.
 */
const extractExports = (source: string, filePath = ''): string[] => {
  const names = new Set<string>();
  
  try {
    const ast = parse(source, {
      loc: false,
      range: false,
      tokens: false,
      comment: false,
      jsx: true,
      sourceType: 'module',
      ecmaVersion: 'latest',
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false,
      loggerFn: false
    });

    const traverse = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      // Handle export declarations
      if (node.type === 'ExportNamedDeclaration') {
        // export const X, export function X, export class X
        if (node.declaration) {
          if (node.declaration.type === 'VariableDeclaration') {
            node.declaration.declarations.forEach((decl: any) => {
              if (decl.id && decl.id.name) names.add(decl.id.name);
            });
          } else if (node.declaration.id && node.declaration.id.name) {
            names.add(node.declaration.id.name);
          }
        }
        // export { X, Y as Z }
        if (node.specifiers) {
          node.specifiers.forEach((spec: any) => {
            if (spec.exported && spec.exported.name) {
              names.add(spec.exported.name);
            }
          });
        }
      }

      // Handle default exports
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration && node.declaration.id && node.declaration.id.name) {
          names.add(node.declaration.id.name);
        } else {
          names.add('default');
        }
      }

      // Traverse children
      Object.keys(node).forEach(key => {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(traverse);
        } else if (child && typeof child === 'object') {
          traverse(child);
        }
      });
    };

    traverse(ast);
  } catch (err) {
    // Silently fall back to empty array on parse errors
    // This prevents the entire scan from crashing on syntax errors
  }

  return Array.from(names);
};

/**
 * Execute tasks with limited concurrency to avoid overwhelming the system.
 */
const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let index = 0;
  
  const runner = async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item !== undefined) {
        results[current] = await worker(item);
      }
    }
  };
  
  const workers = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(workers);
  return results;
};

/**
 * Scan a package directory to extract component files and their exports.
 * 
 * @param packageJsonPath - Absolute path to package.json
 * @returns Package scan result with component files, framework info, and Code Connect files
 * 
 * @example
 * ```typescript
 * const result = await scanPackage('/path/to/package.json');
 * console.log(`Found ${result.component_source_files.length} component files`);
 * console.log(`Primary framework: ${result.primary_framework}`);
 * ```
 */
export async function scanPackage(packageJsonPath: string): Promise<PackageScanResult> {
  const packageDir = path.dirname(packageJsonPath);
  const pkg = await readJsonSafe(packageJsonPath) as any;
  
  // Read package metadata
  const packageInfo = {
    path: path.relative(packageDir, packageJsonPath),
    name: pkg?.name || null,
    directory: packageDir
  };

  // Detect framework
  const frameworkInfo = await detectFrameworks({ 
    root: packageDir, 
    packageJson: pkg, 
    ignore: DEFAULT_IGNORES 
  });

  // Find all TypeScript/TSX files in the package
  const tsFiles = await fg(['**/*.ts', '**/*.tsx'], {
    cwd: packageDir,
    ignore: DEFAULT_IGNORES,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });

  // Extract exports from each file
  const processFile = async (relPath: string) => {
    const absolutePath = path.join(packageDir, relPath);
    const content = await fs.readFile(absolutePath, 'utf8');
    const exports = extractExports(content, relPath);
    return {
      path: relPath,
      exports,
    };
  };

  const componentSourceFiles = await runWithConcurrency(tsFiles, 20, processFile);

  // Detect Angular components if applicable
  const angularComponents = frameworkInfo.frameworks.includes('angular')
    ? await detectAngularComponents({ root: packageDir, ignore: DEFAULT_IGNORES })
    : [];

  // Find existing Code Connect files
  const codeConnectFiles = await fg(['**/*.figma.tsx', '**/*.figma.ts'], {
    cwd: packageDir,
    ignore: DEFAULT_IGNORES,
    dot: false,
    absolute: false,
    suppressErrors: true,
    followSymbolicLinks: false,
  });

  return {
    package: packageInfo,
    primary_framework: frameworkInfo.primaryFramework as "react" | "angular" | null,
    component_source_files: componentSourceFiles,
    angular_components: angularComponents,
    existing_code_connect: codeConnectFiles,
  };
}
