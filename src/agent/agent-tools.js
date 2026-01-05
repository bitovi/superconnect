/**
 * Agent Tools for Claude Agent SDK
 *
 * Implements the tool contract from AGENT-TOOL-CONTRACT.md
 * with metrics instrumentation and hard limits.
 */

const fs = require('fs-extra');
const path = require('path');
const {
  loadIndex,
  findExports,
  findByTag,
  findByPathPrefix,
  listFiles: queryListFiles,
  readFile: cacheReadFile
} = require('../index/index-query');

/**
 * Tool metrics tracker
 */
class ToolMetrics {
  constructor() {
    this.metrics = [];
  }

  record(componentId, tool, params, result, duration) {
    this.metrics.push({
      timestamp: new Date().toISOString(),
      component: componentId,
      tool,
      params,
      result: {
        count: result.files?.length || (result.content ? 1 : 0),
        size_bytes: result.size_bytes || 0,
        cached: result.cached || false
      },
      duration_ms: duration
    });
  }

  async save(outputDir, componentId) {
    const metricsFile = path.join(outputDir, `${componentId}-tool-metrics.jsonl`);
    await fs.ensureDir(path.dirname(metricsFile));

    const lines = this.metrics
      .filter(m => m.component === componentId)
      .map(m => JSON.stringify(m))
      .join('\n');

    if (lines) {
      await fs.appendFile(metricsFile, lines + '\n', 'utf8');
    }
  }

  getSummary(componentId) {
    const filtered = this.metrics.filter(m => m.component === componentId);
    return {
      query_index_calls: filtered.filter(m => m.tool === 'queryIndex').length,
      read_file_calls: filtered.filter(m => m.tool === 'readFile').length,
      read_file_bytes: filtered
        .filter(m => m.tool === 'readFile')
        .reduce((sum, m) => sum + m.result.size_bytes, 0),
      list_files_calls: filtered.filter(m => m.tool === 'listFiles').length,
      cache_hits: filtered.filter(m => m.result.cached).length,
      total_duration_ms: filtered.reduce((sum, m) => sum + m.duration_ms, 0)
    };
  }
}

/**
 * Budget enforcement for file operations
 */
class BudgetEnforcer {
  constructor(componentId) {
    this.componentId = componentId;
    this.readFileCount = 0;
    this.readFileTotalBytes = 0;
    this.listFilesCount = 0;
  }

  checkReadFile(fileSize) {
    if (this.readFileCount >= 20) {
      throw new Error(`READ_BUDGET_EXCEEDED: Max 20 file reads per component`);
    }
    if (this.readFileTotalBytes + fileSize > 5 * 1024 * 1024) {
      throw new Error(`READ_BUDGET_EXCEEDED: Max 5MB cumulative reads per component`);
    }
  }

  recordReadFile(fileSize) {
    this.readFileCount += 1;
    this.readFileTotalBytes += fileSize;
  }

  checkListFiles() {
    if (this.listFilesCount >= 10) {
      throw new Error(`LIST_BUDGET_EXCEEDED: Max 10 list operations per component`);
    }
  }

  recordListFiles() {
    this.listFilesCount += 1;
  }
}

/**
 * Agent Tools Factory
 *
 * Creates tool instances for a specific component
 */
class AgentTools {
  constructor(repoRoot, indexPath, componentId) {
    this.repoRoot = repoRoot;
    this.indexPath = indexPath;
    this.componentId = componentId;
    this.index = null;
    this.metrics = new ToolMetrics();
    this.budget = new BudgetEnforcer(componentId);
  }

  async init() {
    this.index = await loadIndex(this.indexPath);
  }

  /**
   * Query Index Tool
   *
   * Matches the contract from AGENT-TOOL-CONTRACT.md
   */
  async queryIndex({ query, limit = 50 }) {
    const start = Date.now();

    try {
      // Validate query type
      const validTypes = ['exports', 'tag', 'pathPrefix', 'listAll'];
      if (!validTypes.includes(query.type)) {
        throw new Error(`INVALID_QUERY_TYPE: Must be one of ${validTypes.join(', ')}`);
      }

      // Validate value for non-listAll queries
      if (query.type !== 'listAll' && !query.value) {
        throw new Error('MISSING_VALUE: Query value required');
      }

      // Enforce limit
      if (limit > 200) {
        throw new Error('LIMIT_EXCEEDED: Max limit is 200');
      }

      // Execute query
      let result;
      switch (query.type) {
        case 'exports':
          result = findExports(this.index, query.value, limit);
          break;
        case 'tag':
          result = findByTag(this.index, query.value, limit);
          break;
        case 'pathPrefix':
          result = findByPathPrefix(this.index, query.value, limit);
          break;
        case 'listAll':
          result = queryListFiles(this.index, limit);
          break;
      }

      const duration = Date.now() - start;
      this.metrics.record(this.componentId, 'queryIndex', query, result, duration);

      return result;
    } catch (error) {
      return {
        error: {
          code: error.message.split(':')[0],
          message: error.message,
          details: { query, limit }
        }
      };
    }
  }

  /**
   * Read File Tool
   *
   * Matches the contract from AGENT-TOOL-CONTRACT.md
   */
  async readFile({ path: filePath, maxBytes = 102400 }) {
    const start = Date.now();

    try {
      // Validate path (no traversal, no absolute)
      if (filePath.includes('..') || path.isAbsolute(filePath)) {
        throw new Error('INVALID_PATH: No directory traversal or absolute paths allowed');
      }

      // Check file size from index
      const fileEntry = this.index.files.find(f => f.path === filePath);
      const estimatedSize = fileEntry?.size || maxBytes;

      // Check budget before reading
      this.budget.checkReadFile(estimatedSize);

      // Read file with cache
      const result = await cacheReadFile(
        this.repoRoot,
        this.index.repoHash,
        filePath,
        maxBytes
      );

      // Record actual bytes read
      this.budget.recordReadFile(result.size_bytes);

      const duration = Date.now() - start;
      this.metrics.record(this.componentId, 'readFile', { path: filePath }, result, duration);

      return result;
    } catch (error) {
      return {
        error: {
          code: error.message.split(':')[0],
          message: error.message,
          details: { path: filePath, maxBytes }
        }
      };
    }
  }

  /**
   * List Files Tool
   *
   * Matches the contract from AGENT-TOOL-CONTRACT.md
   */
  async listFiles({ directory, pattern, limit = 50 }) {
    const start = Date.now();

    try {
      // Check budget
      this.budget.checkListFiles();

      // Validate directory (no traversal, no absolute)
      if (directory.includes('..') || path.isAbsolute(directory)) {
        throw new Error('INVALID_DIRECTORY: No directory traversal or absolute paths allowed');
      }

      // Enforce limit
      if (limit > 100) {
        throw new Error('LIMIT_EXCEEDED: Max limit is 100');
      }

      // Query index for files in directory
      const normalizedDir = directory.replace(/\\/g, '/');
      const prefix = normalizedDir.endsWith('/') ? normalizedDir : `${normalizedDir}/`;

      let matches = this.index.files.filter(f => {
        const dir = path.dirname(f.path).replace(/\\/g, '/') + '/';
        return dir === prefix;
      });

      // Apply pattern filter if specified
      if (pattern) {
        const globToRegex = (glob) => {
          const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
          const withWildcard = escaped.replace(/\*/g, '.*');
          return new RegExp(`^${withWildcard}$`);
        };
        const regex = globToRegex(pattern);
        matches = matches.filter(f => regex.test(path.basename(f.path)));
      }

      const truncated = matches.length > limit;
      const limited = matches.slice(0, limit);

      const files = limited.map(f => ({
        name: path.basename(f.path),
        path: f.path,
        type: 'file',
        size_bytes: f.size
      }));

      const result = {
        directory,
        files,
        total: matches.length,
        truncated
      };

      this.budget.recordListFiles();

      const duration = Date.now() - start;
      this.metrics.record(this.componentId, 'listFiles', { directory, pattern }, result, duration);

      return result;
    } catch (error) {
      return {
        error: {
          code: error.message.split(':')[0],
          message: error.message,
          details: { directory, pattern, limit }
        }
      };
    }
  }

  /**
   * Get metrics summary for this component
   */
  getMetrics() {
    return this.metrics.getSummary(this.componentId);
  }

  /**
   * Save metrics to disk
   */
  async saveMetrics(outputDir) {
    await this.metrics.save(outputDir, this.componentId);
  }
}

/**
 * Create tool definitions for Claude Agent SDK
 */
function createToolDefinitions() {
  return [
    {
      name: 'queryIndex',
      description: 'Query the pre-built repository index to find candidate files without filesystem crawls. Use this FIRST before reading files.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['exports', 'tag', 'pathPrefix', 'listAll'],
                description: 'Query type: exports (find by symbol), tag (find by category), pathPrefix (find by path), listAll (list all)'
              },
              value: {
                type: 'string',
                description: 'Value to query for (required for exports, tag, pathPrefix)'
              }
            },
            required: ['type']
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default: 50, max: 200)',
            default: 50
          }
        },
        required: ['query']
      }
    },
    {
      name: 'readFile',
      description: 'Read the contents of a specific file. Use queryIndex first to find candidates. Hard limits: 500KB max, 20 files per component, 5MB total.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from repo root'
          },
          maxBytes: {
            type: 'number',
            description: 'Max bytes to read (default: 100KB, max: 500KB)',
            default: 102400
          }
        },
        required: ['path']
      }
    },
    {
      name: 'listFiles',
      description: 'List files in a directory (shallow, non-recursive). Use queryIndex first. Hard limits: 100 results max, 10 calls per component.',
      input_schema: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Relative directory path from repo root'
          },
          pattern: {
            type: 'string',
            description: 'Optional glob pattern (e.g., "*.tsx")'
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default: 50, max: 100)',
            default: 50
          }
        },
        required: ['directory']
      }
    }
  ];
}

module.exports = {
  AgentTools,
  createToolDefinitions,
  ToolMetrics,
  BudgetEnforcer
};
