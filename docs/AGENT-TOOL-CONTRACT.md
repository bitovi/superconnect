# Agent Tool Interface Contract v0.3.x

This document defines the exact tool surface that agentic Code Connect generators will use to explore the codebase and generate mappings. This contract ensures alignment between:
- Tool implementation (`qfq.3`: Agent tool surface with index-first policy)
- Prompt design (`zjb.1`, `zjb.2`: React and Angular agent prompts)
- Integration testing (`8lz.8`: Early integration spike)

**Version**: 0.3.0
**Status**: Contract specification (implementation pending)
**Last Updated**: 2025-12-31

---

## Design Principles

1. **Index-first policy**: Agents should query the repo index before exploring files
2. **Hard limits**: All tools have enforced limits to prevent runaway exploration
3. **Metrics instrumentation**: All tool calls emit usage metrics
4. **Deterministic behavior**: Tools return consistent results for the same inputs
5. **Fail-fast with clear errors**: Invalid inputs produce actionable error messages

---

## Tool Catalog

### 1. `queryIndex`

Query the pre-built repository index to find candidate files without filesystem crawls.

**Purpose**: Primary discovery mechanism. Agents should use this before reading files.

**Parameters**:
```typescript
{
  query: {
    type: 'exports' | 'tag' | 'pathPrefix' | 'listAll',
    value?: string  // Required for 'exports', 'tag', 'pathPrefix'
  },
  limit?: number  // Default: 50, Max: 200
}
```

**Return Value**:
```typescript
{
  files: Array<{
    path: string,           // Relative path from repo root
    exports?: string[],     // Exported identifiers (if available)
    tags?: string[],        // Framework/component tags
    size_bytes?: number,    // File size
    last_modified?: string  // ISO 8601 timestamp
  }>,
  total_matches: number,    // Total before limit applied
  truncated: boolean        // True if results were limited
}
```

**Examples**:
```javascript
// Find files exporting "Button"
queryIndex({ query: { type: 'exports', value: 'Button' }, limit: 10 })

// Find all React component files
queryIndex({ query: { type: 'tag', value: 'react-component' } })

// Find files under src/components/
queryIndex({ query: { type: 'pathPrefix', value: 'src/components/' } })

// List all indexed files
queryIndex({ query: { type: 'listAll' }, limit: 100 })
```

**Errors**:
- `INVALID_QUERY_TYPE`: Query type not in allowed set
- `MISSING_VALUE`: Value required for query type but not provided
- `LIMIT_EXCEEDED`: Requested limit > 200

---

### 2. `readFile`

Read the contents of a specific file from the repository.

**Purpose**: Inspect source code after identifying candidates via `queryIndex`.

**Parameters**:
```typescript
{
  path: string,      // Relative path from repo root
  maxBytes?: number  // Default: 100KB, Max: 500KB
}
```

**Return Value**:
```typescript
{
  path: string,
  content: string,      // File contents (UTF-8)
  size_bytes: number,
  truncated: boolean,   // True if content exceeds maxBytes
  encoding: 'utf-8'
}
```

**Hard Limits**:
- Max file size: 500KB (larger files return error)
- Max concurrent reads per component: 20
- Cumulative read budget per component: 5MB

**Examples**:
```javascript
// Read a component file
readFile({ path: 'src/components/Button.tsx' })

// Read with custom limit
readFile({ path: 'src/theme/tokens.ts', maxBytes: 50000 })
```

**Errors**:
- `FILE_NOT_FOUND`: Path doesn't exist in repo
- `FILE_TOO_LARGE`: File exceeds 500KB hard limit
- `READ_BUDGET_EXCEEDED`: Cumulative read limit for this component reached
- `INVALID_PATH`: Path attempts directory traversal (../) or absolute path

---

### 3. `listFiles`

List files in a specific directory (shallow, non-recursive).

**Purpose**: Explore directory structure when index queries are insufficient.

**Parameters**:
```typescript
{
  directory: string,  // Relative path from repo root
  pattern?: string,   // Glob pattern (e.g., "*.tsx")
  limit?: number      // Default: 50, Max: 100
}
```

**Return Value**:
```typescript
{
  directory: string,
  files: Array<{
    name: string,      // Filename only (no path)
    path: string,      // Full relative path
    type: 'file' | 'directory',
    size_bytes?: number  // Only for files
  }>,
  total: number,       // Total items before limit
  truncated: boolean
}
```

**Hard Limits**:
- Max results per call: 100
- Max list operations per component: 10
- Non-recursive (single directory level only)

**Examples**:
```javascript
// List all files in a directory
listFiles({ directory: 'src/components' })

// List only TypeScript files
listFiles({ directory: 'src/components', pattern: '*.{ts,tsx}' })
```

**Errors**:
- `DIRECTORY_NOT_FOUND`: Directory doesn't exist
- `LIST_BUDGET_EXCEEDED`: Too many list operations for this component
- `INVALID_DIRECTORY`: Path attempts traversal or absolute path

---

## Tool Usage Policy

### Index-First Workflow

Agents **must** follow this decision tree:

```
1. Can I find candidates using queryIndex?
   YES → Use queryIndex first
   NO  → Justify why index is insufficient, then use listFiles

2. Do I need to see file contents?
   YES → Use readFile on specific paths from queryIndex results
   NO  → Proceed with index metadata only

3. Do I need to explore a directory structure?
   YES → Explain why queryIndex can't answer the question
   → Use listFiles (limited to 10 calls per component)
   NO  → Use index results
```

### Justification Requirement

Before using `listFiles` or making >5 `readFile` calls, agents must:
1. State what information is needed
2. Explain why `queryIndex` results are insufficient
3. Describe the exploration strategy

**Example prompt snippet**:
```
Before reading files or listing directories:
1. Query the index first using queryIndex
2. If you need to explore beyond the index, explain:
   - What specific information you're looking for
   - Why the index results don't contain it
   - How many files you plan to read/list
```

---

## Metrics and Instrumentation

Every tool call emits metrics stored in `superconnect/<component-id>/tool-metrics.jsonl`:

```jsonl
{"timestamp":"2025-12-31T10:00:00Z","component":"Button","tool":"queryIndex","query_type":"exports","results":3,"duration_ms":12}
{"timestamp":"2025-12-31T10:00:01Z","component":"Button","tool":"readFile","path":"src/Button.tsx","size_bytes":4521,"duration_ms":5}
{"timestamp":"2025-12-31T10:00:02Z","component":"Button","tool":"listFiles","directory":"src/components","results":15,"duration_ms":8}
```

### Reported Metrics

Per component:
- `query_index_calls`: Number of queryIndex invocations
- `read_file_calls`: Number of readFile invocations
- `read_file_bytes`: Total bytes read via readFile
- `list_files_calls`: Number of listFiles invocations
- `cache_hits`: Number of cached file reads

Aggregate across run:
- `total_query_calls`: Sum of all queryIndex calls
- `total_file_reads`: Sum of all readFile calls
- `avg_reads_per_component`: Average readFile calls per component
- `index_first_ratio`: Percentage of components that used queryIndex before readFile

---

## Error Handling

All tools return errors in a consistent format:

```typescript
{
  error: {
    code: string,        // Error code (e.g., "FILE_NOT_FOUND")
    message: string,     // Human-readable description
    details?: object     // Additional context
  }
}
```

### Error Response Example

```json
{
  "error": {
    "code": "READ_BUDGET_EXCEEDED",
    "message": "Cumulative read limit (5MB) exceeded for component 'Button'",
    "details": {
      "bytes_read": 5242880,
      "limit_bytes": 5242880,
      "files_read": 18
    }
  }
}
```

Agents should:
1. Check for `error` field in all responses
2. Log the error code and message
3. Retry with adjusted parameters if applicable
4. Fail the component generation if error is unrecoverable

---

## Cache Behavior

The file read cache (from `qfq.2`) operates transparently:

- Cache key: `(repo_hash, file_path)`
- Cache invalidation: On repo_hash change
- Cache hit → response includes `"cached": true`
- Metrics track cache hits separately

Agents don't need to manage caching; it's automatic.

---

## Implementation Checklist

- [ ] `queryIndex` implementation in `src/agent/tools/query-index.js`
- [ ] `readFile` implementation in `src/agent/tools/read-file.js`
- [ ] `listFiles` implementation in `src/agent/tools/list-files.js`
- [ ] Budget enforcement and metrics emission
- [ ] Error handling with contract-specified codes
- [ ] Integration tests verifying contract compliance
- [ ] Prompt templates referencing exact tool names and parameters

---

## Appendix: Index Schema

The repo index (from `qfq.1`) contains:

```typescript
{
  repo_hash: string,        // Stable hash for cache invalidation
  generated_at: string,     // ISO 8601 timestamp
  files: Array<{
    path: string,           // Relative from repo root
    exports: string[],      // Top-level exports
    tags: string[],         // ["react-component", "typescript", etc.]
    size_bytes: number,
    last_modified: string
  }>,
  statistics: {
    total_files: number,
    total_exports: number,
    by_tag: Record<string, number>
  }
}
```

**Performance target** (from `qfq.1`):
Index queries must complete in <10ms for 95th percentile on repos with <10k files.

---

**Version History**:
- v0.3.0 (2025-12-31): Initial contract specification

**Related Documents**:
- `qfq.1`: Revise repo index schema and performance targets
- `qfq.2`: Index query module and file read cache
- `qfq.3`: Agent tool surface with index-first policy
- `zjb.1`: React agent prompt grounded in Figma docs
- `zjb.2`: Angular agent prompt grounded in Figma docs
