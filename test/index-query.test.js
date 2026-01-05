const fs = require('fs-extra');
const path = require('path');
const {
  loadIndex,
  findExports,
  findByTag,
  findByPathPrefix,
  listFiles,
  readFile,
  clearCache,
  getCacheStats
} = require('../src/index/index-query');

describe('Index Query Module', () => {
  const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'react-sample');
  const indexPath = path.join(fixtureRoot, 'superconnect', 'repo-index.json');

  let index;

  beforeAll(async () => {
    // Ensure index exists
    if (!await fs.pathExists(indexPath)) {
      throw new Error(`Index not found at ${indexPath}. Run: node scripts/build-repo-index.js --root fixtures/react-sample`);
    }
    index = await loadIndex(indexPath);
  });

  afterEach(() => {
    clearCache();
  });

  describe('loadIndex', () => {
    it('loads a valid index', async () => {
      expect(index.schema).toBe('repo-index@1');
      expect(index.repoHash).toBeDefined();
      expect(Array.isArray(index.files)).toBe(true);
      expect(typeof index.exportIndex).toBe('object');
    });

    it('throws on missing index', async () => {
      await expect(loadIndex('/nonexistent/path')).rejects.toThrow('Index not found');
    });
  });

  describe('findExports', () => {
    it('finds files exporting a symbol', () => {
      const result = findExports(index, 'App');
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].path).toContain('App');
      expect(result.total_matches).toBeGreaterThan(0);
    });

    it('returns empty for nonexistent symbol', () => {
      const result = findExports(index, 'NonExistentSymbol');
      expect(result.files).toEqual([]);
      expect(result.total_matches).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('respects limit', () => {
      const result = findExports(index, 'App', 1);
      expect(result.files.length).toBeLessThanOrEqual(1);
    });
  });

  describe('findByTag', () => {
    it('finds files by tag', () => {
      // Note: react-sample might not have tagged files
      const result = findByTag(index, 'component');
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.total_matches).toBeGreaterThanOrEqual(0);
    });

    it('respects limit', () => {
      const result = findByTag(index, 'component', 1);
      expect(result.files.length).toBeLessThanOrEqual(1);
    });
  });

  describe('findByPathPrefix', () => {
    it('finds files by path prefix', () => {
      const result = findByPathPrefix(index, 'src/');
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every(f => f.path.startsWith('src/'))).toBe(true);
    });

    it('handles trailing slash', () => {
      const result = findByPathPrefix(index, 'src');
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('respects limit', () => {
      const result = findByPathPrefix(index, 'src/', 1);
      expect(result.files.length).toBeLessThanOrEqual(1);
    });
  });

  describe('listFiles', () => {
    it('lists all files', () => {
      const result = listFiles(index);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.total_matches).toBe(index.files.length);
    });

    it('respects limit', () => {
      const result = listFiles(index, 1);
      expect(result.files.length).toBe(1);
      expect(result.truncated).toBe(index.files.length > 1);
    });
  });

  describe('readFile', () => {
    it('reads a file', async () => {
      const result = await readFile(fixtureRoot, index.repoHash, 'src/App.tsx');
      expect(result.content).toContain('App');
      expect(result.size_bytes).toBeGreaterThan(0);
      expect(result.cached).toBe(false);
      expect(result.encoding).toBe('utf-8');
    });

    it('caches file reads', async () => {
      // First read
      const first = await readFile(fixtureRoot, index.repoHash, 'src/App.tsx');
      expect(first.cached).toBe(false);

      // Second read (cached)
      const second = await readFile(fixtureRoot, index.repoHash, 'src/App.tsx');
      expect(second.cached).toBe(true);
      expect(second.content).toBe(first.content);
    });

    it('throws on nonexistent file', async () => {
      await expect(readFile(fixtureRoot, index.repoHash, 'nonexistent.ts'))
        .rejects.toThrow('FILE_NOT_FOUND');
    });

    it('respects maxBytes', async () => {
      const result = await readFile(fixtureRoot, index.repoHash, 'src/App.tsx', 10);
      expect(result.content.length).toBeLessThanOrEqual(10);
      expect(result.truncated).toBe(result.size_bytes > 10);
    });
  });

  describe('cache management', () => {
    it('clears cache', async () => {
      await readFile(fixtureRoot, index.repoHash, 'src/App.tsx');
      expect(getCacheStats().size).toBeGreaterThan(0);

      clearCache();
      expect(getCacheStats().size).toBe(0);
    });

    it('provides cache stats', async () => {
      await readFile(fixtureRoot, index.repoHash, 'src/App.tsx');
      const stats = getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toContain(`${index.repoHash}:src/App.tsx`);
    });
  });
});
