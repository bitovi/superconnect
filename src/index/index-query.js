/**
 * Index Query Module
 *
 * Provides fast lookup functions over the repo index without filesystem crawls.
 * Supports the agent tool contract (queryIndex, readFile with caching).
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * In-memory file read cache
 * Key format: `${repoHash}:${filePath}`
 */
const fileReadCache = new Map();

/**
 * Load repo index from disk
 */
async function loadIndex(indexPath) {
  if (!await fs.pathExists(indexPath)) {
    throw new Error(`Index not found: ${indexPath}`);
  }
  const raw = await fs.readFile(indexPath, 'utf8');
  const index = JSON.parse(raw);

  if (!index.schema || !index.schema.startsWith('repo-index@')) {
    throw new Error(`Invalid index schema: ${index.schema}`);
  }

  return index;
}

/**
 * Find files that export a specific symbol
 *
 * @param {object} index - The loaded repo index
 * @param {string} symbolName - Export name to search for
 * @param {number} [limit=50] - Max results to return
 * @returns {object} Query result with files array
 */
function findExports(index, symbolName, limit = 50) {
  const paths = index.exportIndex[symbolName] || [];
  const truncated = paths.length > limit;
  const limited = paths.slice(0, limit);

  const files = limited.map(p => {
    const entry = index.files.find(f => f.path === p);
    return entry ? {
      path: entry.path,
      exports: entry.exports,
      tags: entry.tags,
      size_bytes: entry.size,
      package_root: entry.packageRoot
    } : { path: p };
  });

  return {
    files,
    total_matches: paths.length,
    truncated
  };
}

/**
 * Find files by tag (component, hook, util, etc.)
 *
 * @param {object} index - The loaded repo index
 * @param {string} tag - Tag to filter by
 * @param {number} [limit=50] - Max results to return
 * @returns {object} Query result with files array
 */
function findByTag(index, tag, limit = 50) {
  const matches = index.files.filter(f => f.tags.includes(tag));
  const truncated = matches.length > limit;
  const limited = matches.slice(0, limit);

  const files = limited.map(f => ({
    path: f.path,
    exports: f.exports,
    tags: f.tags,
    size_bytes: f.size,
    package_root: f.packageRoot
  }));

  return {
    files,
    total_matches: matches.length,
    truncated
  };
}

/**
 * Find files by path prefix
 *
 * @param {object} index - The loaded repo index
 * @param {string} prefix - Path prefix to match
 * @param {number} [limit=50] - Max results to return
 * @returns {object} Query result with files array
 */
function findByPathPrefix(index, prefix, limit = 50) {
  const normalizedPrefix = prefix.replace(/\\/g, '/');
  const matches = index.files.filter(f => f.path.startsWith(normalizedPrefix));
  const truncated = matches.length > limit;
  const limited = matches.slice(0, limit);

  const files = limited.map(f => ({
    path: f.path,
    exports: f.exports,
    tags: f.tags,
    size_bytes: f.size,
    package_root: f.packageRoot
  }));

  return {
    files,
    total_matches: matches.length,
    truncated
  };
}

/**
 * List all indexed files (with limit)
 *
 * @param {object} index - The loaded repo index
 * @param {number} [limit=50] - Max results to return
 * @returns {object} Query result with files array
 */
function listFiles(index, limit = 50) {
  const truncated = index.files.length > limit;
  const limited = index.files.slice(0, limit);

  const files = limited.map(f => ({
    path: f.path,
    exports: f.exports,
    tags: f.tags,
    size_bytes: f.size,
    package_root: f.packageRoot
  }));

  return {
    files,
    total_matches: index.files.length,
    truncated
  };
}

/**
 * Read file with cache
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} repoHash - Repository hash for cache key
 * @param {string} filePath - Relative file path
 * @param {number} [maxBytes=102400] - Max bytes to read (100KB default)
 * @returns {Promise<object>} File contents and metadata
 */
async function readFile(repoRoot, repoHash, filePath, maxBytes = 102400) {
  const cacheKey = `${repoHash}:${filePath}`;

  // Check cache
  if (fileReadCache.has(cacheKey)) {
    const cached = fileReadCache.get(cacheKey);
    return { ...cached, cached: true };
  }

  // Read from disk
  const absolute = path.join(repoRoot, filePath);

  if (!await fs.pathExists(absolute)) {
    throw new Error(`FILE_NOT_FOUND: ${filePath}`);
  }

  const stat = await fs.stat(absolute);

  if (stat.size > 500 * 1024) {
    throw new Error(`FILE_TOO_LARGE: ${filePath} exceeds 500KB limit`);
  }

  let content = await fs.readFile(absolute, 'utf8');
  let truncated = false;

  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
    truncated = true;
  }

  const result = {
    path: filePath,
    content,
    size_bytes: stat.size,
    truncated,
    encoding: 'utf-8',
    cached: false
  };

  // Cache the result
  fileReadCache.set(cacheKey, { ...result, cached: false });

  return result;
}

/**
 * Clear the file read cache
 */
function clearCache() {
  fileReadCache.clear();
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: fileReadCache.size,
    keys: Array.from(fileReadCache.keys())
  };
}

module.exports = {
  loadIndex,
  findExports,
  findByTag,
  findByPathPrefix,
  listFiles,
  readFile,
  clearCache,
  getCacheStats
};
