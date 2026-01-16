/**
 * Shared filesystem utilities.
 * Consolidated here to avoid duplication across scripts.
 */

import fs from 'fs-extra';

/**
 * Read and parse a JSON file, returning null on any error.
 * @param filePath - Path to JSON file
 * @returns Parsed JSON object or null if error
 */
export const readJsonSafe = async (filePath: string): Promise<unknown | null> => {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
};

/**
 * Read a text file, returning null if it doesn't exist or on error.
 * @param filePath - Path to text file
 * @returns File contents or null if error
 */
export const readFileSafe = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Check if a path exists.
 * @param filePath - Path to check
 * @returns True if path exists, false otherwise
 */
export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};
