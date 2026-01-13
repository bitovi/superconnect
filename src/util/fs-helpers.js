/**
 * Shared filesystem utilities.
 * Consolidated here to avoid duplication across scripts.
 */

const fs = require('fs-extra');

/**
 * Read and parse a JSON file, returning null on any error.
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<object|null>}
 */
const readJsonSafe = async (filePath) => {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
};

/**
 * Read a text file, returning null if it doesn't exist or on error.
 * @param {string} filePath - Path to text file
 * @returns {Promise<string|null>}
 */
const readFileSafe = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Check if a path exists.
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  readJsonSafe,
  readFileSafe,
  pathExists
};
