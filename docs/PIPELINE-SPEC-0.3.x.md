# Superconnect 0.3.x Pipeline Specification

**Version:** 0.3.x  
**Status:** Implementation in progress  
**Breaking Changes:** YES - Not backward compatible with 0.2.x

## Executive Summary

The 0.3.x pipeline consolidates the 5-stage 0.2.x architecture into a streamlined 3-stage process:

| 0.2.x (Legacy) | 0.3.x (Current) |
|----------------|-----------------|
| 5 stages | 3 stages |
| Repo summarizer → Figma scan → Orienter → Codegen → Finalizer | Index builder → Unified codegen → Finalizer |
| Separate orientation + codegen | Single agentic call per component |
| Filesystem exploration | Pre-built searchable index |
| No tool access | Agent tools (queryIndex, readFile, listFiles) |
| Error accumulation | Per-component validation loop |

## Pipeline Stages

### Stage 1: Index Builder

**Module:** `src/index/index-builder.js`  
**Purpose:** Build searchable index replacing filesystem exploration  
**Replaces:** 0.2.x Repo Summarizer

**Inputs:**
- Target repo root path
- Framework detection results (React, Angular)

**Behavior:**
1. Scan repo for TypeScript/TSX files (ignore `node_modules`, `dist`, etc.)
2. Extract exports from each file (functions, components, constants)
3. Tag files by type (react-component, angular-component, theme-recipe, etc.)
4. Build inverse indexes:
   - Export name → file paths
   - Path prefix → file paths
   - Tags → file paths
5. Store Angular-specific metadata (selectors, module membership)

**Outputs:**
- `superconnect/repo-index.json` – Searchable index optimized for agent queries
  ```json
  {
    "files": [
      {
        "path": "src/components/Button.tsx",
        "exports": ["Button", "ButtonProps"],
        "tags": ["react-component"],
        "size": 1234,
        "modified": "2025-01-02T10:00:00Z"
      }
    ],
    "exports": {
      "Button": ["src/components/Button.tsx"],
      "ButtonProps": ["src/components/Button.tsx"]
    },
    "pathPrefixes": {
      "src/components/": ["src/components/Button.tsx", "..."]
    },
    "tags": {
      "react-component": ["src/components/Button.tsx", "..."]
    },
    "metadata": {
      "packageJson": { "name": "...", "version": "..." },
      "frameworks": ["react"],
      "angularComponents": []
    }
  }
  ```

### Stage 2: Unified Codegen

**Module:** `src/agent/unified-codegen.js`  
**Purpose:** Single agentic flow with tools generates Code Connect files  
**Replaces:** 0.2.x Orienter + Codegen (2 stages → 1 stage)

**Inputs:**
- `superconnect/repo-index.json`
- `superconnect/figma-components-index.json`
- `superconnect/figma-components/*.json`
- Agent configuration (API, model, max_tokens)

**Agent Tools:**

| Tool | Purpose | Limits |
|------|---------|--------|
| `queryIndex` | Search index by export name, path prefix, or tag | No limit |
| `readFile` | Read specific file contents | 20 files, 500KB max per file, 5MB total |
| `listFiles` | List directory contents (shallow) | 10 calls max |

**Per-Component Flow:**

```
For each Figma component:
  1. Load Figma metadata and repo index
  2. Build system prompt (framework-specific + tool guidance)
  3. Build user prompt (Figma properties + index summary)
  4. Call agent with tools
     loop: while agent makes tool calls
       execute tool → return result to agent
  5. Extract code from response
  6. Validate code against Figma data
  7. If invalid and retries remain:
       append errors to prompt → retry (goto step 4)
  8. If valid or max retries exceeded:
       write output → save metrics → next component
```

**Validation Checks:**

| Figma API Call | Required Figma Data |
|----------------|---------------------|
| `figma.enum('KEY', ...)` | KEY exists in `variantProperties` |
| `figma.boolean('KEY')` | KEY exists in `componentProperties` (type: BOOLEAN) |
| `figma.string('KEY')` | KEY exists in `componentProperties` (type: TEXT) |
| `figma.instance('KEY')` | KEY exists in `componentProperties` (type: INSTANCE_SWAP) |
| `figma.textContent('KEY')` | KEY exists in `textLayers` |
| `figma.children('KEY')` | KEY exists in `slotLayers` |

**Retry Logic:**
- Max retries: 2 (configurable via `DEFAULT_MAX_RETRIES`)
- On failure: Append validation errors to user prompt
- After max retries: Record failure, continue to next component
- No cross-component state (each component independent)

**Outputs:**
- `codeConnect/<Component>.figma.tsx` (successful only)
- `superconnect/codegen-summaries/<id>-codegen-summary.json`
  ```json
  {
    "componentId": "react-1",
    "componentName": "Button",
    "status": "success",
    "attempts": 1,
    "outputPath": "codeConnect/Button.figma.tsx"
  }
  ```
- `superconnect/codegen-agent-transcripts/<framework>-<id>-attempt<N>.log`
- `superconnect/agent-tool-metrics/<id>-tool-metrics.json`
  ```json
  {
    "filesRead": 2,
    "queries": 3,
    "listCalls": 0,
    "totalBytesRead": 12345
  }
  ```

### Stage 3: Finalizer

**Module:** `scripts/finalize.js`  
**Purpose:** Summarize run and write `figma.config.json`  
**Changes from 0.2.x:** Updated to read new artifact paths (no orientation.jsonl)

**Inputs:**
- `superconnect/figma-components-index.json`
- `superconnect/codegen-summaries/*.json`
- `codeConnect/*.figma.tsx` or `.figma.ts`

**Behavior:**
1. Correlate Figma components with codegen results
2. Count successes, failures, skips
3. Print colorized run summary to stdout
4. Write `figma.config.json` at repo root

**Output:** `figma.config.json`
```json
{
  "parser": "react",
  "include": ["codeConnect/**", "src/**"],
  "exclude": ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
  "label": "React",
  "documentUrlSubstitutions": {
    "<FIGMA_BUTTON>": "https://figma.com/file/abc?node-id=1:2"
  }
}
```

## Artifacts Reference

### Kept from 0.2.x

| Path | Purpose |
|------|---------|
| `figma-components-index.json` | Figma file and component list |
| `figma-components/<slug>.json` | Per-component Figma metadata |
| `codegen-summaries/<id>-codegen-summary.json` | Per-component result |
| `figma.config.json` (repo root) | Code Connect configuration |
| `codeConnect/*.figma.tsx` or `.figma.ts` | Generated Code Connect files |

### Removed from 0.2.x

| Path | Reason |
|------|--------|
| `repo-summary.json` | Replaced by `repo-index.json` |
| `orientation.jsonl` | Orientation merged into unified codegen |
| `orienter-agent.log` | Replaced by per-component transcripts |
| `orienter-agent-payload.txt` | No longer relevant |

### New in 0.3.x

| Path | Purpose |
|------|---------|
| `repo-index.json` | Searchable index for agent tools |
| `agent-tool-metrics/<id>-tool-metrics.json` | Tool usage per component |
| `codegen-agent-transcripts/<framework>-<id>-attempt<N>.log` | Per-attempt logs (not single log) |

## CLI Flags

### Kept from 0.2.x

| Flag | Purpose |
|------|---------|
| `--figma-url URL` | Figma file URL or key |
| `--figma-token TOKEN` | Figma API token (or use `FIGMA_ACCESS_TOKEN`) |
| `--target PATH` | Target repo path |
| `--framework react\|angular` | Force framework detection |
| `--only PATTERN` | Process only matching components |
| `--exclude PATTERN` | Exclude matching components |
| `--force` | Overwrite existing Code Connect files |
| `--dry-run` | Preview without writing files |

### Removed from 0.3.x

| Flag | Reason |
|------|--------|
| `--target-framework` | Redundant with `--framework` |
| `--fake-orienter-output` | No separate orienter stage |

### New in 0.3.x

*None yet - 0.3.x uses same CLI surface as 0.2.x (minus removed flags)*

## Configuration (`superconnect.toml`)

### Agent Configuration

```toml
[agent]
api = "anthropic"  # or "openai"
model = "claude-sonnet-4-20250514"
max_tokens = 4096
# base_url = "https://api.openai.com/v1"  # optional, for OpenAI-compatible endpoints
# api_key = "sk-..."  # optional, overrides environment variables
```

**Defaults:**
- `api`: `"anthropic"`
- `model`: Provider-specific default
- `max_tokens`: `4096` (was `2048` in 0.2.x codegen, `32768` in 0.2.x orienter)

### Retry Configuration

```toml
[codegen]
max_retries = 2
```

**Defaults:**
- `max_retries`: `2` (defined as `DEFAULT_MAX_RETRIES` in `unified-codegen.js`)

## Implementation Status

### ✅ Completed

- `src/agent/unified-codegen.js` – Core unified codegen module
- `src/agent/agent-adapter.js` – Tool support (`chatWithTools` method)
- `src/agent/agent-tools.js` – Tool implementations (queryIndex, readFile, listFiles)
- `src/index/index-query.js` – Index query functions
- `prompts/react-agentic-codegen.md` – React prompt with tool guidance
- `prompts/angular-agentic-codegen.md` – Angular prompt with tool guidance
- `test/unified-codegen.test.js` – Unit tests (6 tests passing)
- Integration spike demonstrating end-to-end flow

### 🚧 In Progress

- `scripts/run-pipeline.js` – Pipeline orchestrator updates
- `src/index/index-builder.js` – Index builder implementation

### 📋 Planned

- Remove `scripts/run-orienter.js` (no longer needed)
- Update `scripts/run-codegen.js` to use `unified-codegen.js`
- Update `scripts/finalize.js` to read new artifact paths
- Full e2e tests with React and Angular fixtures
- Performance benchmarking vs 0.2.x baseline

## Known Issues from Integration Spike

See `docs/INTEGRATION-SPIKE-FINDINGS.md` for details.

**Summary:**
1. ❌ Agent not following "raw code only" instruction (adds explanatory text)
2. ❌ Validation too lenient (passes code with wrapper text)
3. ⚠️ Agent not using repo index effectively (0 queries despite tool availability)
4. ⚠️ Missing export data in react-sample fixture repo index

**Mitigation Plan:**
- Strengthen prompt: "Do not include ANY explanatory text..."
- Add pre-validation check: code must start with `import` or `export`
- Ensure repo index includes proper export data for all fixtures
- Add explicit instruction: "You MUST call queryIndex first..."

## Backward Compatibility

**0.3.x is NOT backward compatible with 0.2.x.**

### Breaking Changes

1. **Artifact Structure:**
   - `orientation.jsonl` no longer exists
   - `repo-summary.json` replaced by `repo-index.json` (different schema)
   - Per-component transcript structure changed

2. **CLI Flags:**
   - `--fake-orienter-output` removed
   - `--target-framework` removed (use `--framework`)

3. **Configuration:**
   - `max_tokens` default changed: 2048/32768 → 4096
   - New `[codegen]` section for retry config

### Migration Path

**There is no automatic migration from 0.2.x to 0.3.x.**

To use 0.3.x:
1. Delete existing `superconnect/` directory
2. Run `superconnect` with 0.3.x to regenerate all artifacts
3. Update any scripts that parse `orientation.jsonl` or `repo-summary.json`

## Testing Requirements

Before marking 0.3.x complete:

### Unit Tests
- ✅ `test/unified-codegen.test.js` (6 tests passing)
- ✅ `test/agent-tools.test.js` (passing)
- ✅ `test/agent-adapter.test.js` (passing)
- ✅ `test/index-query.test.js` (passing)

### Integration Tests
- ✅ `scripts/integration-spike.js` (manual test)
- ⏳ React fixture e2e (pending full pipeline implementation)
- ⏳ Angular fixture e2e (pending full pipeline implementation)

### Performance Tests
- ⏳ Benchmark vs 0.2.x baseline (captured in `superconnect-qfq.6`)
- ⏳ Verify 0.3.x is not significantly slower than 0.2.x

### Validation Gates
- ⏳ `pnpm test` (all tests passing)
- ⏳ Small e2e run for React fixture with `scripts/run-pipeline.js`
- ⏳ Small e2e run for Angular fixture with `scripts/run-pipeline.js`

## References

- Original 0.2.x architecture: `docs/ARCHITECTURE-0.2.x.md` (backup)
- Integration spike findings: `docs/INTEGRATION-SPIKE-FINDINGS.md`
- Agent tool contract: `docs/AGENT-TOOL-CONTRACT.md`
- Repo index specification: (TBD - create if needed)

✠
