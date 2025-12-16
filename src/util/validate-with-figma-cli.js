/**
 * Validate Code Connect files using the official Figma CLI.
 *
 * This provides authoritative validation - if the Figma CLI accepts a file,
 * it will work with `figma connect publish`. The CLI catches errors that
 * our regex-based validation cannot detect, such as:
 *   - Props used in example() but not defined in the props object
 *   - Invalid TypeScript/JSX syntax
 *   - Incorrect figma.* helper usage
 *
 * @module validate-with-figma-cli
 */

const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * Validate Code Connect code using the Figma CLI's parse command.
 *
 * @param {object} options
 * @param {string} options.code - The Code Connect file content to validate
 * @param {'react'|'html'} options.parser - Parser to use (react for .tsx, html for .ts)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateWithFigmaCLI({ code, parser = 'react' }) {
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
    const result = spawnSync(
      'npx',
      ['@figma/code-connect', 'connect', 'parse', '-c', tempConfig, '--exit-on-unreadable-files'],
      {
        cwd: tempDir, // Run from temp directory so relative glob works
        encoding: 'utf8',
        timeout: 30000, // 30 second timeout
        env: { ...process.env, FORCE_COLOR: '0' } // Disable colors for easier parsing
      }
    );

    // Clean up temp directory
    fs.removeSync(tempDir);

    // Check for success
    if (result.status === 0 && !result.stderr?.includes('ParserError')) {
      return { valid: true, errors: [] };
    }

    // Parse errors from output
    const errors = extractErrors(result.stdout, result.stderr);

    return {
      valid: false,
      errors: errors.length > 0 ? errors : ['Figma CLI validation failed (unknown error)']
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
  try {
    const result = spawnSync('npx', ['@figma/code-connect', '--version'], {
      encoding: 'utf8',
      shell: true,
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
