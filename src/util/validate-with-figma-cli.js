/**
 * Validate Code Connect files using the official Figma CLI.
 *
 * This provides authoritative validation - if the Figma CLI accepts a file,
 * it will work with `figma connect publish`. The CLI validates:
 *   - Code Connect API structure (e.g., object literal requirement)
 *   - Props used in example() but not defined in the props object
 *   - Incorrect figma.* helper usage
 *
 * Note: The CLI does NOT validate TypeScript/JSX syntax errors - it uses
 * a tolerant parser that may auto-correct or ignore syntax issues.
 * See docs/FIGMA-CLI-VALIDATION.md for details.
 *
 * @module validate-with-figma-cli
 */

const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * Resolve the path to the @figma/code-connect CLI binary.
 * Works with pnpm, npm, and yarn by walking up from the resolved module.
 *
 * @returns {string|null} Absolute path to the CLI binary, or null if not found
 */
function resolveFigmaCLI() {
  try {
    // Resolve the main module entry point
    const moduleEntry = require.resolve('@figma/code-connect');
    // Walk up to find the package root (where package.json lives)
    let dir = path.dirname(moduleEntry);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const cliPath = path.join(dir, 'bin', 'figma');
        if (fs.existsSync(cliPath)) {
          return cliPath;
        }
      }
      dir = path.dirname(dir);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate Code Connect code using the Figma CLI's parse command.
 *
 * @param {object} options
 * @param {string} options.code - The Code Connect file content to validate
 * @param {'react'|'html'} options.parser - Parser to use (react for .tsx, html for .ts)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateWithFigmaCLI({ code, parser = 'react' }) {
  // Resolve the CLI binary path from node_modules
  const cliPath = resolveFigmaCLI();

  if (!cliPath) {
    return {
      valid: false,
      errors: [
        'Figma Code Connect CLI not found.',
        '',
        'This is required for validation. To fix:',
        '  1. Ensure @figma/code-connect is installed: pnpm install',
        '  2. Or install globally: pnpm add -g @figma/code-connect',
        ''
      ]
    };
  }

  // Verify the CLI works
  const cliCheck = spawnSync(process.execPath, [cliPath, '--version'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: 'pipe'
  });

  if (cliCheck.error || cliCheck.status !== 0) {
    return {
      valid: false,
      errors: [
        'Figma Code Connect CLI not working properly.',
        '',
        'This is required for validation. To fix:',
        '  1. Ensure @figma/code-connect is installed: pnpm install',
        '  2. Or install globally: pnpm add -g @figma/code-connect',
        '',
        `Error details: ${cliCheck.error?.message || cliCheck.stderr || 'Unknown error'}`
      ]
    };
  }

  const ext = parser === 'react' ? '.figma.tsx' : '.figma.ts';

  // Create a temporary directory with the file and config
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superconnect-validate-'));
  const tempFile = path.join(tempDir, `temp${ext}`);
  const tempConfig = path.join(tempDir, 'figma.config.json');

  // Write the code to the temp file
  fs.writeFileSync(tempFile, code, 'utf8');

  // Use relative glob pattern - Figma CLI doesn't accept absolute paths
  const config = {
    codeConnect: {
      parser,
      include: [`*${ext}`]
    }
  };

  try {
    fs.writeJsonSync(tempConfig, config);

    // Run figma connect parse with --exit-on-unreadable-files to get exit code 1 on errors
    // Use node to directly execute the CLI binary (no shell overhead, works cross-platform)
    const configBasename = path.basename(tempConfig);
    const result = spawnSync(
      process.execPath,
      [cliPath, 'connect', 'parse', '-c', configBasename, '--exit-on-unreadable-files'],
      {
        cwd: tempDir, // Run from temp directory so relative glob and config work
        encoding: 'utf8',
        timeout: 30000, // 30 second timeout
        env: { ...process.env, FORCE_COLOR: '0' } // Disable colors for easier parsing
      }
    );

    // Clean up temp directory - use try/catch to handle Windows file locking issues
    // Windows may hold locks on files briefly after the process exits
    try {
      fs.removeSync(tempDir);
    } catch {
      // Ignore cleanup errors - temp dir will be cleaned up by OS eventually
    }

    // Check for success
    if (result.status === 0 && !result.stderr?.includes('ParserError')) {
      return { valid: true, errors: [] };
    }

    // Parse errors from output
    const errors = extractErrors(result.stdout, result.stderr);

    // If we couldn't extract specific errors, include raw output for debugging
    if (errors.length === 0) {
      const debugInfo = [];
      debugInfo.push('Figma CLI validation failed with no parseable errors.');
      debugInfo.push('');
      debugInfo.push(`Exit code: ${result.status}`);
      if (result.stdout) debugInfo.push(`stdout: ${result.stdout.substring(0, 500)}`);
      if (result.stderr) debugInfo.push(`stderr: ${result.stderr.substring(0, 500)}`);
      if (result.error) debugInfo.push(`error: ${result.error.message}`);
      return { valid: false, errors: debugInfo };
    }

    return {
      valid: false,
      errors
    };
  } catch (err) {
    // Clean up on error
    try {
      fs.removeSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }

    return {
      valid: false,
      errors: [`Figma CLI validation error: ${err.message}`]
    };
  }
}

/**
 * Extract human-readable error messages from Figma CLI output.
 * @param {string} stdout
 * @param {string} stderr
 * @returns {string[]}
 */
function extractErrors(stdout = '', stderr = '') {
  const errors = [];
  const combined = `${stdout}\n${stderr}`;

  // Look for ParserError messages
  // Format: "ParserError\nundefined: <message>\n -> <file>:<line>:<col>"
  const parserErrorPattern = /ParserError[\s\S]*?:\s*([^\n]+)\s*\n\s*->\s*[^:]+:(\d+):(\d+)/g;
  let match;
  while ((match = parserErrorPattern.exec(combined)) !== null) {
    const message = match[1].trim();
    const line = match[2];
    const col = match[3];
    errors.push(`Line ${line}: ${message}`);
  }

  // Also check for the common "Could not find prop mapping" error
  const propMappingPattern = /Could not find prop mapping for (\w+)/g;
  while ((match = propMappingPattern.exec(combined)) !== null) {
    const propName = match[1];
    // Only add if not already captured by parserErrorPattern
    const alreadyCaptured = errors.some((e) => e.includes(propName));
    if (!alreadyCaptured) {
      errors.push(`Prop '${propName}' used in example() but not defined in props object`);
    }
  }

  // Check for import resolution warnings (non-fatal but good to know)
  const importWarningPattern = /Import for (\w+) could not be resolved/g;
  while ((match = importWarningPattern.exec(combined)) !== null) {
    // Don't treat as error - this is often expected during validation
  }

  // Check for generic "unreadable files" exit
  if (combined.includes('Exiting due to unreadable files') && errors.length === 0) {
    errors.push('Code Connect file could not be parsed by Figma CLI');
  }

  return errors;
}

/**
 * Check if the Figma CLI is available.
 * @returns {boolean}
 */
function isFigmaCLIAvailable() {
  const cliPath = resolveFigmaCLI();
  if (!cliPath) {
    return false;
  }
  try {
    const result = spawnSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
      timeout: 10000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

module.exports = {
  validateWithFigmaCLI,
  isFigmaCLIAvailable,
  extractErrors
};
