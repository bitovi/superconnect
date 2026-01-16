# Superconnect Architecture

## Overview

Superconnect is a Node.js CLI (distributed as the `superconnect` npm package, Node >= 20) that runs a five‑stage pipeline:

1. **Repo summarizer** – scan a React/TypeScript or Angular repo for components and exports
2. **Figma scan** – download component metadata from a Figma file
3. **Orienter** – an agent decides which source files matter for each Figma component
4. **Codegen** – agent produces a mapping schema rendered into `.figma.tsx` (React) or `.figma.ts` (Angular)
5. **Finalizer** – summarizes the run and writes `figma.config.json` for Code Connect

The pipeline is orchestrated by `scripts/run-pipeline.js` and exposed as the `superconnect` binary.

## Runtime components

- **CLI orchestrator** (`scripts/run-pipeline.js`)
  - Parses CLI flags (`--figma-url`, `--figma-token`, `--target`, `--framework`, `--only`, `--exclude`, `--force`, `--dry-run`)
  - Loads configuration from `superconnect.toml`, prompting the user to create it if missing
  - Resolves a target repo, validates access, and computes paths under `superconnect-logs/` and `codeConnect/`
  - Reads `FIGMA_ACCESS_TOKEN` and agent API keys from the environment or a `.env` file in the target repo
  - Decides which stages to run based on existing artifacts and `--force`, and blocks agent stages when API keys are missing unless `--dry-run` is set
  - When `SUPERCONNECT_E2E_VERBOSE` is truthy, captures stage stdout/stderr for easier test debugging

- **Agent adapters** (`src/agent/agent-adapter.js`)
  - `OpenAIAgentAdapter` (OpenAI Responses API)
  - `ClaudeAgentAdapter` (Anthropic Messages API)
  - `AgentSDKAdapter` (Anthropic Claude Agent SDK with built-in tools)
  - Implement a shared interface:
    - `orient({ payload, logLabel, outputStream, logDir })` – single-turn for orienter stage
    - `chatStateless({ system, user, maxTokens, logLabel })` – single-turn stateless call for direct codegen (used for initial generation and retry attempts)
  - Handle:
    - Model selection and `maxTokens` from config
    - Writing `=== AGENT INPUT ===` and `=== AGENT OUTPUT ===` logs to disk
    - Returning `{ text, usage }` or `{ code, stdout, stderr, logFile }` to callers
  - `AgentSDKAdapter` allows agent to explore codebase using Read, Glob, and Grep tools before generating Code Connect files

## Pipeline stages and data flow

### 1. Repo summarizer (`scripts/summarize-repo.js`)

- Inputs:
  - Target repo root (`--root` or positional)
- Behavior:
  - Ignores standard build/dep directories (`node_modules`, `dist`, `build`, etc.)
  - Locates likely component roots (e.g., `src/components`, `packages/*/src/components`, `apps/*/src/components`)
  - Detects Angular components and module membership, capturing selectors and HTML/template files
  - Locates theme recipe directories (e.g., `src/theme/recipes`, `packages/*/src/theme/recipes`)
  - Collects TypeScript/TSX files under those roots
  - For each file:
    - Reads content and extracts exported identifiers using regexes
  - Produces `superconnect-logs/repo-summary.json` with:
    - Package.json summary
    - TS config locations
    - Detected frameworks (`frameworks`, `primary_framework` via heuristics for React/Angular)
    - Detected Angular components (selectors, module/html files)
    - Existing Code Connect files and configs
    - Component roots, theme roots
    - `component_source_files` (paths + exports)
    - Detected lockfiles, `.env` file presence, and common build/tooling config files

### 2. Figma scan (`scripts/figma-scan.js`)

- Inputs:
  - Figma file key or URL
  - Figma API token (`FIGMA_ACCESS_TOKEN` or `--token`)
  - Output directory for per‑component JSON
- Behavior:
  - Fetches the Figma file via `https://api.figma.com`
  - Walks the document tree, finding `COMPONENT_SET` nodes (component sets)
  - Filters out “hidden” component sets (names starting with `_`/`.`, or that sanitize to `_`)
  - For each component set:
    - Extracts variants and variant properties
    - Normalizes variant keys/values and computes enum shapes
    - Extracts component property definitions and references
    - Computes a stable checksum
  - Writes `superconnect-logs/figma-components/<slug>.json`
  - Writes `superconnect-logs/figma-components-index.json` summarizing the file and components

### 3. Orienter (`scripts/run-orienter.js`)

- Inputs:
  - `superconnect-logs/figma-components-index.json`
  - `superconnect-logs/repo-summary.json`
  - Agent backend, model, and max tokens (from CLI and `superconnect.toml`)
  - Optional target framework hint (`--target-framework`) and dry-run/fake output flags
- Behavior:
  - Reads the orienter prompt (`prompts/orienter.md`)
  - Builds a payload with:
    - Prompt text
    - Pretty‑printed Figma index JSON
    - Pretty‑printed repo summary JSON
    - Target framework hint for downstream codegen
  - Calls the configured agent via `AgentAdapter.orient`, or writes payload-only/fake outputs when `--dry-run`/`--fake-orienter-output` are set
  - Streams agent stdout into:
    - `superconnect-logs/orientation.jsonl` (one JSON object per component)
    - A log file at `superconnect-logs/orienter-agent.log`
  - For `--dry-run` and `--fake-orienter-output`, writes the payload preview to `superconnect-logs/orienter-agent-payload.txt`
- Position in pipeline:
  - Executed immediately before codegen and grouped with codegen in run output/log coloring to reflect it as part of the generation phase
- Output data model (per line, JSON):
  - `figmaComponentId` / `figma_component_id`
  - `figmaComponentName` / `figma_component_name`
  - `status`: `"mapped" | "missing" | "ambiguous"`
  - `files`: array of repo‑relative file paths

### 4. Codegen (`scripts/run-codegen.js`)

Uses direct codegen approach where agents generate complete Code Connect files with built-in validation and retry logic.

- Inputs:
  - `superconnect-logs/figma-components-index.json`
  - `superconnect-logs/figma-components/*.json`
  - `superconnect-logs/orientation.jsonl`
  - `superconnect-logs/repo-summary.json` (framework hints and Angular component metadata)
  - Agent backend configuration (same as Orienter)

- Architecture:
  - Each component gets an independent agent call with cached system prefix
  - System prompt includes full Code Connect API documentation
  - For each component: generate → validate → retry if needed → move to next
  - Validate BEFORE moving on (prevents error accumulation across components)
  - This approach enables stateless processing with validation isolation

- Modules:
  - `src/react/direct-codegen.js` – React direct codegen implementation
  - `src/angular/direct-codegen.js` – Angular direct codegen implementation
  - `src/util/validate-code-connect.js` – Validation layer

- Validation layer checks:
  - All `figma.enum('KEY', ...)` calls: KEY must exist in `variantProperties`
  - All `figma.boolean('KEY')` calls: KEY must exist in `componentProperties` as BOOLEAN type
  - All `figma.string('KEY')` calls: KEY must exist in `componentProperties` as TEXT type
  - All `figma.instance('KEY')` calls: KEY must exist in `componentProperties` as INSTANCE_SWAP type
  - All `figma.textContent('KEY')` calls: KEY must exist in `textLayers`
  - All `figma.children('KEY')` calls: KEY must exist in `slotLayers`

- Retry behavior:
  - On validation failure, provide previous code + specific errors
  - Agent attempts to fix within same conversation (maintains context)
  - Max retries: 2 (configurable in `superconnect.toml`)
  - After max retries, record failure and move to next component

- Agent adapter support:
  - Uses `chatStateless({ system, user, maxTokens, logLabel })` method
  - System prompt is cached across calls for efficiency
  - Each component call is independent (stateless)

- Output:
  - `codeConnect/<Component>.figma.tsx` or `.figma.ts` (unless skipped or blocked by existing file and no `--force`)
  - `superconnect-logs/codegen-summaries/*-codegen-summary.json` (per‑component results)
  - `superconnect-logs/codegen-agent-transcripts/*-attempt*.log` (full agent I/O transcripts)
- Codegen respects:
  - `--only` / `--exclude` filters (names/IDs/globs)
  - `--force` for overwriting existing mapping files

### 5. Finalizer (`scripts/finalize.js`)

- Inputs:
  - `superconnect-logs/figma-components-index.json`
  - `superconnect-logs/orientation.jsonl`
  - `superconnect-logs/codegen-summaries/*.json`
  - `codeConnect/*.figma.tsx` / `*.figma.ts`
- Behavior:
  - Correlates Figma components with codegen results
  - Builds a summary of:
    - Figma scanning (file metadata, component counts)
    - Repo scanning and orientation coverage
    - Codegen successes and skips (with reasons)
  - Prints a colorized run summary to stdout
  - Creates/overwrites `figma.config.json` at the target repo root with:
  - `include`/`exclude` globs for Code Connect files plus common source roots (currently includes `packages/**/*.{ts,tsx}` and `apps/**/*.{ts,tsx}`)
  - Parser and label (`react` or `html`) chosen from detected/target framework
  - Optional `interactiveSetupFigmaFileUrl`
  - `documentUrlSubstitutions` mapping tokens (e.g., `<FIGMA_BUTTON>`) to live Figma node URLs plus `<FIGMA_ICONS_BASE>` for convenience
  - Optional `codeConnect.paths` entries for monorepo package import aliases when detected

## Configuration and assumptions

- **Config file**: `superconnect.toml`
  - `[inputs]` – `figma_file_url`, `component_repo_path`
  - `[agent]` – `api`, `model`, `max_tokens`, `llm_proxy_url`, `api_key`
    - `api` – `"anthropic-agent-sdk"`, `"anthropic-messages-api"`, or `"openai-chat-api"` (default: anthropic-agent-sdk)
    - `model` – model name (e.g., `"gpt-5.2-codex"`, `"claude-sonnet-4-5"`)
    - `max_tokens` – max output tokens (default: 2048 for codegen, 32768 for orientation)
    - `llm_proxy_url` – (optional) base URL for OpenAI-compatible endpoints (LiteLLM, Azure, vLLM, etc.)
    - `api_key` – (optional) API key override (takes precedence over environment variables)
  - Parsed via a lightweight TOML parser that supports:
    - Top‑level keys
    - Single‑level sections
    - Comments (`#`) trailing on lines
- **Environment variables**
  - `FIGMA_ACCESS_TOKEN` – required for Figma scan (or `--figma-token`), read from the process environment or `.env` in the target repo. At minimum this token must allow:
    - Files: `file_content:read`
    - Development: `file_code_connect:write`, `file_dev_resources:read`, `file_dev_resources:write`
  - `ANTHROPIC_API_KEY` – for Anthropic API, read from the process environment or `.env` in the target repo
  - `OPENAI_API_KEY` – for OpenAI API, read from the process environment or `.env` in the target repo
  - `OPENAI_BASE_URL` – (optional) base URL for OpenAI-compatible endpoints, can be overridden by `llm_proxy_url` in TOML

Assumptions:
- Target repos are React/TypeScript or Angular projects with components under conventional roots (`src/components`, `packages/*/src/components`, `src/app/**/*.component.ts`, etc.)
- The mapping between Figma components and React components can be expressed as:
  - A single import path and component name
  - A finite set of props expressed as enums/booleans/strings/instances
- Angular connectors expose component selectors and inputs in HTML templates; defaults fall back to stubs when agent data is unavailable

## Integrations

- **Figma API**
  - Used only by `scripts/figma-scan.js`
  - Accessed via `undici.fetch` with `X-Figma-Token` header
- **Figma Code Connect**
  - Consumes:
    - `codeConnect/*.figma.tsx` or `.figma.ts` files generated by Superconnect
    - `figma.config.json` produced by the Finalizer, including document URL substitutions
  - Uses the React parser for `.tsx` outputs and the HTML parser for Angular `.ts` outputs
- **LLM backends**
  - OpenAI Responses API and Anthropic Claude SDK provide:
    - Repository orientation (Stage 3)
    - Mapping schemas (Stage 4)
  - OpenAI-compatible endpoints supported via `base_url` config:
    - LiteLLM (proxy for 100+ LLM providers)
    - Azure OpenAI
    - vLLM (high-performance inference server)
    - LocalAI and other OpenAI-compatible servers

Secret symbol: ✠
