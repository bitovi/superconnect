# Repository Index

The repository index is a pre-built metadata file that enables fast file discovery without filesystem crawls during agentic code generation.

**Version**: `repo-index@1`
**Location**: `superconnect/repo-index.json` (generated per target repo)

---

## Purpose

In 0.3.x agentic mode, agents use the repo index to:
1. **Find candidate files** by exported symbols (e.g., "which files export `Button`?")
2. **Filter by tags** (e.g., "show me all component files")
3. **Resolve imports** without reading every file in the repo
4. **Cache file reads** using the stable `repoHash` for invalidation

The index-first approach reduces filesystem I/O and LLM context by providing structured metadata upfront.

---

## Schema

### Top-Level Fields

| Field | Type | Purpose |
|-------|------|---------|
| `schema` | string | Version identifier (`repo-index@1`) |
| `root` | string | Absolute path to repo root |
| `generatedAt` | string | ISO 8601 timestamp of index generation |
| `repoHash` | string | SHA-256 hash of all file paths, sizes, and mtimes for cache invalidation |
| `maxFileBytes` | number | Max file size parsed (default: 200KB) |
| `ignorePatterns` | string[] | Glob patterns excluded from indexing |
| `filePatterns` | string[] | Glob patterns included in indexing |
| `packageRoots` | string[] | Detected package.json directories (for monorepo imports) |
| `stats` | object | Summary statistics (see below) |
| `files` | File[] | Array of file metadata entries |
| `exportIndex` | object | Map of symbol name → file paths |

### File Entry Schema

```typescript
{
  path: string,           // Repo-relative path (POSIX format)
  packageRoot: string,    // Nearest package.json directory
  size: number,           // File size in bytes
  language: string,       // ts, tsx, js, jsx, mjs, cjs, mts, cts
  tags: string[],         // Inferred tags (component, hook, util, theme, etc.)
  exports: string[],      // Exported identifiers (includes "default")
  reexportAll: string[], // Re-export specifiers (export * from "...")
  importsLocal: string[], // Local import specifiers (./foo, ../bar)
  parseStatus: string     // "parsed" | "skipped:size"
}
```

### Stats Object

```typescript
{
  totalFiles: number,        // Total files found
  parsedFiles: number,       // Files successfully parsed
  skippedLargeFiles: number, // Files exceeding maxFileBytes
  byLanguage: {              // Breakdown by file extension
    [language: string]: number
  }
}
```

### Export Index

```typescript
{
  [symbolName: string]: string[]  // Symbol → file paths
}
```

**Example**:
```json
{
  "Button": ["src/components/Button.tsx", "src/index.ts"],
  "useTheme": ["src/hooks/useTheme.ts"],
  "default": ["src/App.tsx", "src/theme/index.ts"]
}
```

---

## Performance Targets

### Measurement Method

Use the `time` command with the `build-repo-index.js` script:

```bash
time node scripts/build-repo-index.js \
  --root /path/to/repo \
  --output /path/to/repo/superconnect/repo-index.json
```

Look at the **total** time (wall-clock).

### Baseline Performance (0.2.x vs 0.3.x)

**Target**: Index generation in 0.3.x should be **≤2x slower** than 0.2.x `repo-summary.json` generation.

**Measured baseline** (on Apple M3, 8 cores):
- **Chakra UI** (2,390 files, 4,787 exports): **0.313s**
- **React sample** (1 file): **<0.1s**

Since 0.2.x doesn't have explicit index generation, the 0.3.x runtime should not degrade overall pipeline performance by more than 2x when index generation is included.

### Query Performance Targets

Once implemented (qfq.2), index queries must meet:

| Operation | Target (p95) | Repo Size |
|-----------|--------------|-----------|
| `findExports(name)` | <10ms | <10k files |
| `findByTag(tag)` | <10ms | <10k files |
| `findByPathPrefix(prefix)` | <10ms | <10k files |
| `listFiles()` | <10ms | <10k files |

For larger repos (>10k files), targets scale linearly.

---

## Cache Invalidation

The `repoHash` is a stable SHA-256 hash computed from:
- File path (POSIX format)
- File size (bytes)
- File mtime (milliseconds since epoch)

**Invalidation rules**:
- Hash changes → index is stale → regenerate
- Files added/removed/modified → hash changes
- File reads (qfq.2) cache results keyed by `(repoHash, filePath)`

**Implementation** (from `scripts/build-repo-index.js:286-291`):
```javascript
const repoHash = crypto.createHash('sha256');
hashParts
  .sort((a, b) => a.path.localeCompare(b.path))
  .forEach((part) => {
    repoHash.update(`${part.path}|${part.size}|${part.mtimeMs}\n`);
  });
```

---

## Tag Inference

Tags are inferred from file paths using simple heuristics:

| Tag | Condition |
|-----|-----------|
| `component` | Path includes `/components/` |
| `hook` | Path includes `/hooks/` |
| `util` | Path includes `/utils/` or `/util/` |
| `theme` | Path includes `/theme/`, `/tokens/`, or `/recipes/` |
| `icon` | Path includes `/icons/` or `/icon/` |
| `style` | Path includes `/styles/` or `/style/` |
| `example` | Path includes `/examples/`, `/example/`, or `/demo/` |
| `test` | Path includes `__tests__`, `.test.`, or `.spec.` |
| `story` | Path includes `.stories.`, `/stories/`, or `storybook` |

Tags enable fast filtering without file reads:
```javascript
// Find all component files
index.files.filter(f => f.tags.includes('component'))
```

---

## Usage

### Generating the Index

```bash
node scripts/build-repo-index.js --root /path/to/repo
```

Options:
- `--root <path>`: Repository root (default: current directory)
- `--output <path>`: Output JSON file (default: `<root>/superconnect/repo-index.json`)
- `--max-file-bytes <n>`: Max file size to parse (default: 204800 = 200KB)

### Querying the Index

See `qfq.2` (Index query module) and `qfq.3` (Agent tool surface) for query APIs.

---

## Field Usage Rationale

| Field | Why It Exists |
|-------|---------------|
| `schema` | Version pinning for downstream tools |
| `root` | Absolute path for tooling provenance |
| `generatedAt` | Debugging and audit trail |
| `repoHash` | Cache invalidation key |
| `maxFileBytes` | Make coverage limits explicit |
| `ignorePatterns` | Document what was excluded |
| `filePatterns` | Document what was included |
| `packageRoots` | Monorepo import resolution |
| `stats` | Sanity checks for partial scans |
| `files[].path` | Stable identifier for tool calls |
| `files[].packageRoot` | Resolve import bases during codegen |
| `files[].size` | Pack sizing hints without storing content |
| `files[].language` | Route React vs Angular heuristics |
| `files[].tags` | Cheap filtering without file reads |
| `files[].exports` | Map symbols (includes "default") |
| `files[].reexportAll` | Track barrel files (export *) |
| `files[].importsLocal` | Dependency slice for context packs |
| `files[].parseStatus` | Signal missing or skipped parse data |
| `exportIndex` | Fast symbol → file lookup for orientation |

---

## Migration from 0.2.x

**0.2.x**: `summarize-repo.js` → `superconnect/repo-summary.json`
**0.3.x**: `build-repo-index.js` → `superconnect/repo-index.json`

**Key differences**:
- 0.3.x index includes `exportIndex` for O(1) symbol lookups
- 0.3.x includes `repoHash` for cache invalidation
- 0.3.x adds `tags` for fast filtering
- 0.3.x uses concurrent processing (30 workers) for faster generation

**Backward compatibility**: 0.3.x does not support 0.2.x `repo-summary.json` format.

---

## Related Documents

- `AGENT-TOOL-CONTRACT.md`: Tools that consume this index
- `ARCHITECTURE.md`: Pipeline overview
- `qfq.1`: This task (Revise repo index schema and performance targets)
- `qfq.2`: Index query module and file read cache
- `qfq.3`: Agent tool surface with index-first policy
