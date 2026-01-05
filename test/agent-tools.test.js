const fs = require('fs-extra');
const path = require('path');
const { AgentTools, createToolDefinitions } = require('../src/agent/agent-tools');
const { clearCache } = require('../src/index/index-query');

describe('Agent Tools', () => {
  const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'react-sample');
  const indexPath = path.join(fixtureRoot, 'superconnect', 'repo-index.json');
  let tools;

  beforeEach(async () => {
    clearCache(); // Clear file read cache between tests
    tools = new AgentTools(fixtureRoot, indexPath, 'test-component');
    await tools.init();
  });

  describe('queryIndex', () => {
    it('queries by exports', async () => {
      const result = await tools.queryIndex({
        query: { type: 'exports', value: 'App' }
      });
      expect(result.files).toBeDefined();
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.total_matches).toBeGreaterThan(0);
    });

    it('queries by tag', async () => {
      const result = await tools.queryIndex({
        query: { type: 'tag', value: 'component' }
      });
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
    });

    it('queries by pathPrefix', async () => {
      const result = await tools.queryIndex({
        query: { type: 'pathPrefix', value: 'src/' }
      });
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0].path).toContain('src/');
    });

    it('lists all files', async () => {
      const result = await tools.queryIndex({
        query: { type: 'listAll' }
      });
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('rejects invalid query type', async () => {
      const result = await tools.queryIndex({
        query: { type: 'invalid' }
      });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INVALID_QUERY_TYPE');
    });

    it('rejects missing value', async () => {
      const result = await tools.queryIndex({
        query: { type: 'exports' }
      });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('MISSING_VALUE');
    });

    it('enforces limit', async () => {
      const result = await tools.queryIndex({
        query: { type: 'listAll' },
        limit: 300
      });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('LIMIT_EXCEEDED');
    });

    it('records metrics', async () => {
      await tools.queryIndex({
        query: { type: 'exports', value: 'App' }
      });
      const metrics = tools.getMetrics();
      expect(metrics.query_index_calls).toBe(1);
    });
  });

  describe('readFile', () => {
    it('reads a file', async () => {
      const result = await tools.readFile({ path: 'src/App.tsx' });
      expect(result.content).toBeDefined();
      expect(result.content).toContain('App');
      expect(result.size_bytes).toBeGreaterThan(0);
      expect(result.encoding).toBe('utf-8');
    });

    it('rejects directory traversal', async () => {
      const result = await tools.readFile({ path: '../evil.txt' });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INVALID_PATH');
    });

    it('rejects absolute paths', async () => {
      const result = await tools.readFile({ path: '/etc/passwd' });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INVALID_PATH');
    });

    it('enforces max reads per component', async () => {
      // Read 20 times (the limit)
      for (let i = 0; i < 20; i++) {
        await tools.readFile({ path: 'src/App.tsx' });
      }

      // 21st read should fail
      const result = await tools.readFile({ path: 'src/App.tsx' });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('READ_BUDGET_EXCEEDED');
    });

    it('records metrics', async () => {
      await tools.readFile({ path: 'src/App.tsx' });
      const metrics = tools.getMetrics();
      expect(metrics.read_file_calls).toBe(1);
      expect(metrics.read_file_bytes).toBeGreaterThan(0);
    });

    it('tracks cache hits', async () => {
      const first = await tools.readFile({ path: 'src/App.tsx' });
      expect(first.cached).toBe(false);
      const second = await tools.readFile({ path: 'src/App.tsx' });
      expect(second.cached).toBe(true);
      const metrics = tools.getMetrics();
      expect(metrics.cache_hits).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listFiles', () => {
    it('lists files in directory', async () => {
      const result = await tools.listFiles({ directory: 'src' });
      expect(result.files).toBeDefined();
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.directory).toBe('src');
    });

    it('applies pattern filter', async () => {
      const result = await tools.listFiles({
        directory: 'src',
        pattern: '*.tsx'
      });
      expect(result.files).toBeDefined();
      if (result.files.length > 0) {
        expect(result.files[0].name).toMatch(/\.tsx$/);
      }
    });

    it('rejects directory traversal', async () => {
      const result = await tools.listFiles({ directory: '../evil' });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INVALID_DIRECTORY');
    });

    it('enforces limit', async () => {
      const result = await tools.listFiles({
        directory: 'src',
        limit: 200
      });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('LIMIT_EXCEEDED');
    });

    it('enforces max calls per component', async () => {
      // Call 10 times (the limit)
      for (let i = 0; i < 10; i++) {
        await tools.listFiles({ directory: 'src' });
      }

      // 11th call should fail
      const result = await tools.listFiles({ directory: 'src' });
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('LIST_BUDGET_EXCEEDED');
    });

    it('records metrics', async () => {
      await tools.listFiles({ directory: 'src' });
      const metrics = tools.getMetrics();
      expect(metrics.list_files_calls).toBe(1);
    });
  });

  describe('metrics', () => {
    it('aggregates metrics correctly', async () => {
      await tools.queryIndex({ query: { type: 'listAll' } });
      await tools.readFile({ path: 'src/App.tsx' });
      await tools.listFiles({ directory: 'src' });

      const metrics = tools.getMetrics();
      expect(metrics.query_index_calls).toBe(1);
      expect(metrics.read_file_calls).toBe(1);
      expect(metrics.list_files_calls).toBe(1);
      expect(metrics.total_duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('saves metrics to disk', async () => {
      const tmpDir = path.join(__dirname, '..', 'tmp', 'test-metrics');
      await fs.ensureDir(tmpDir);

      await tools.queryIndex({ query: { type: 'listAll' } });
      await tools.saveMetrics(tmpDir);

      const metricsFile = path.join(tmpDir, 'test-component-tool-metrics.jsonl');
      const exists = await fs.pathExists(metricsFile);
      expect(exists).toBe(true);

      const content = await fs.readFile(metricsFile, 'utf8');
      expect(content).toContain('queryIndex');

      // Cleanup
      await fs.remove(tmpDir);
    });
  });

  describe('createToolDefinitions', () => {
    it('returns valid tool definitions', () => {
      const defs = createToolDefinitions();
      expect(Array.isArray(defs)).toBe(true);
      expect(defs.length).toBe(3);
      expect(defs[0].name).toBe('queryIndex');
      expect(defs[1].name).toBe('readFile');
      expect(defs[2].name).toBe('listFiles');
      expect(defs[0].input_schema).toBeDefined();
    });
  });
});
