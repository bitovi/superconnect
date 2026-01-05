# Superconnect Architecture (0.3.x)

## Version Notice

**This document describes the 0.3.x architecture.**

0.3.x represents a breaking architectural change from 0.2.x:
- **0.2.x** (legacy): 5-stage pipeline with separate orientation and codegen
- **0.3.x** (current): 4-stage pipeline with unified agentic codegen

**For detailed pipeline specification, see [PIPELINE-SPEC-0.3.x.md](./PIPELINE-SPEC-0.3.x.md).**  
**For 0.2.x architecture, see [ARCHITECTURE-0.2.x.md](./ARCHITECTURE-0.2.x.md).**

## Overview

Superconnect is a Node.js CLI that generates Figma Code Connect mappings using AI-powered agents. The 0.3.x pipeline consists of four stages:

1. **Repo indexer** – Build searchable index of codebase
2. **Figma scan** – Extract component metadata from Figma file
3. **Unified codegen** – Generate Code Connect files with agent tools
4. **Finalizer** – Summarize results and write config

## Key Changes from 0.2.x

### Unified Agentic Flow
- **Before (0.2.x)**: Separate orientation stage → codegen stage
- **After (0.3.x)**: Single agent call handles both exploration and generation

### Agent Tools
Agents can now explore the codebase during generation:
- `queryIndex(query)` – Semantic search across indexed codebase
- `readFile(path, startLine, endLine)` – Read specific file sections
- `listFiles(directory)` – List directory contents

### Validation Loop
- Built-in validation after each generation attempt
- Automatic retry on validation failure (max 2 retries)
- Prevents error accumulation

### Index-First Approach
- Pre-built searchable index replaces filesystem exploration
- Fast semantic queries enable intelligent file discovery
- Tool usage metrics tracked per component

## Pipeline Stages

### 1. Repo Indexer (`scripts/build-repo-index.js`)

Builds searchable index of the codebase:
- File tree with paths, sizes, types
- Import and export statements
- Component definitions (React/Angular)
- Angular-specific metadata (selectors, templates)

**Input:** Target repo path  
**Output:** `superconnect/repo-index.json`

### 2. Figma Scan (`scripts/figma-scan.js`)

Extracts component metadata from Figma file:
- Component sets and variants
- Properties and their types
- Text layers and slots
- Stable checksums for caching

**Input:** Figma file URL/key + API token  
**Output:** 
- `superconnect/figma-components-index.json`
- `superconnect/figma-components/{component}.json` (per component)

### 3. Unified Codegen (`scripts/run-codegen.js`)

Generates Code Connect files using agent with tools:
- Agent loads Figma component metadata
- Explores codebase using queryIndex, readFile, listFiles
- Generates Code Connect mapping file
- Validates output (retry on failure)
- Writes tool metrics and attempt logs

**Input:** Figma components + repo index  
**Output:** 
- `codeConnect/{component}.figma.tsx` (React) or `.figma.ts` (Angular)
- `superconnect/codegen-summaries/{component}-codegen-summary.json`

### 4. Finalizer (`scripts/finalize.js`)

Summarizes the run and writes configuration:
- Prints human-friendly summary with stats
- Writes `figma.config.json` at repo root
- Sets parser and include globs for framework

**Input:** All pipeline artifacts  
**Output:** 
- Console summary
- `figma.config.json`

## Agent Architecture

### Agent Adapter (`src/agent/agent-adapter.js`)

The `ClaudeAgentAdapter` provides:
- Multi-turn conversation with tool support
- Attempt logging to disk
- Token tracking and metrics
- Model: Claude Sonnet 4 (default)

### Agent Tools (`src/agent/agent-tools.js`)

The `AgentTools` class enforces safety constraints:
- Max file size: 100KB per read
- Max results: 20 per query/list operation
- No path traversal (must stay within repo)
- Metrics: calls, bytes read, cache hits, duration

### Unified Codegen (`src/agent/unified-codegen.js`)

Core logic for agentic code generation:
- Builds system and user prompts from templates
- Handles tool calls (queryIndex, readFile, listFiles)
- Validates generated Code Connect syntax
- Retries on validation failure (max attempts configurable)
- Returns attempt logs and metrics

## Framework Support

### React
- Generates `.figma.tsx` files
- Uses `figma.connect()` API with JSX examples
- Supports variants, props, children
- Prompt: `prompts/react-agentic-codegen.md`

### Angular
- Generates `.figma.ts` files
- Uses `figma.connect()` with `html` template strings
- Matches component selectors
- Supports property bindings and slots
- Prompt: `prompts/angular-agentic-codegen.md`

## Configuration

### Environment Variables
- `FIGMA_ACCESS_TOKEN` – Figma personal access token (required)
- `ANTHROPIC_API_KEY` – Anthropic API key for Claude (required)
- `SUPERCONNECT_E2E_VERBOSE` – Enable verbose logging for tests (optional)

### Configuration File (`superconnect.toml`)
```toml
[inputs]
figma_url = "https://figma.com/file/..."
component_repo_path = "."

[agent]
api = "anthropic"
model = "claude-sonnet-4-20250514"

[codegen]
max_tokens = 4096
max_retries = 2
```

## Testing

### Unit Tests
- `test/agent-adapter.test.js` – Agent adapter functionality
- `test/agent-tools.test.js` – Tool implementations and limits
- `test/index-query.test.js` – Index querying logic
- `test/unified-codegen.test.js` – Core codegen logic

### E2E Tests
- `test/pipeline-0.3.x-e2e.test.js` – Full pipeline on fixtures
  - React fixture (FixtureComponent)
  - Angular fixture (Button component)
  - Tool usage verification

### Skipped Tests (0.2.x Features)
- `test/react-orienter.test.js` – Orientation stage removed
- `test/angular-orienter.test.js` – Orientation stage removed
- `test/framework-plumbing.test.js` – Tests orienter payload

## Migration from 0.2.x

### For Users
No changes required – CLI usage unchanged:
```bash
pnpm exec superconnect
```

### For Contributors
- See archived 0.2.x code in `scripts/archive/`
- Old architecture docs: `docs/ARCHITECTURE-0.2.x.md`
- orientation.jsonl no longer generated
- Agent tools replace filesystem exploration

## Performance Characteristics

### Improvements
- Single agent call per component (vs two in 0.2.x)
- Agent tools enable targeted file reads
- Index queries faster than filesystem scanning

### Trade-offs
- Upfront indexing cost (amortized across components)
- Tool calls add latency per component
- Claude Sonnet 4 slower than Haiku (higher quality)

## Known Issues (Deferred to 0.3.1)

1. **Agent explanatory text**: Agents sometimes add explanations before code blocks (validation still passes)
2. **Validation leniency**: Need to verify validation catches all edge cases
3. **Prompt evaluation**: Need automated harness for prompt quality
4. **Tool underuse**: Some agents don't explore enough before generating
5. **Incremental runs**: No caching or incremental support yet

See `docs/INTEGRATION-SPIKE-FINDINGS.md` for detailed analysis.
