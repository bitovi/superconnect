# Superconnect Architecture

## Overview

Superconnect is a Node.js CLI (`superconnect`) that runs a five‑stage pipeline:

1. **Repo summarizer** – scan a React/TypeScript repo for components and exports.
2. **Figma scan** – download component metadata from a Figma file.
3. **Orienter** – part of the code generation flow; an agent decides which source files matter for each Figma component.
4. **Codegen** – agent produces a mapping schema that is rendered into `.figma.tsx`.
5. **Finalizer** – summarizes the run and writes `figma.config.json` for Code Connect.

The pipeline is orchestrated by `scripts/run-pipeline.js` and exposed as the `superconnect` binary.

## Runtime components

- **CLI orchestrator** (`scripts/run-pipeline.js`)
  - Parses CLI flags (`--figma-url`, `--figma-token`, `--target`, `--only`, `--exclude`, `--force`).
  - Loads configuration from `superconnect.toml`, prompting the user to create it if missing.
  - Resolves a target repo, validates access, and computes paths under `superconnect/` and `codeConnect/`.
  - Decides which stages to run based on existing artifacts and `--force`.

- **Agent adapters** (`src/agent/agent-adapter.js`)
  - `OpenAIAgentAdapter` (Responses API) and `ClaudeAgentAdapter` (Anthropic SDK).
  - Implement a shared interface:
    - `orient({ payload, logLabel, outputStream, logDir })`
    - `codegen({ payload, logLabel, cwd, logDir })`
  - Handle:
    - Model selection and `maxTokens` from config.
    - Writing `=== AGENT INPUT/OUTPUT ===` logs to disk.
    - Returning `{ code, stdout, stderr, logFile }` to callers.

## Pipeline stages and data flow

### 1. Repo summarizer (`scripts/summarize-repo.js`)

- Inputs:
  - Target repo root (`--root` or positional).
- Behavior:
  - Ignores standard build/dep directories (`node_modules`, `dist`, `build`, etc.).
  - Locates likely component roots (e.g., `src/components`, `packages/*/src/components`).
  - Locates theme recipe directories (e.g., `src/theme/recipes`).
  - Collects TypeScript/TSX files under those roots.
  - For each file:
    - Reads content and extracts exported identifiers using regexes.
  - Produces `superconnect/repo-summary.json` with:
    - Package.json summary.
    - TS config locations.
    - Detected frameworks (`frameworks`, `primary_framework` via heuristics for React/Angular).
    - Existing Code Connect files and configs.
    - Component roots, theme roots.
    - `component_source_files` (paths + exports).

### 2. Figma scan (`scripts/figma-scan.js`)

- Inputs:
  - Figma file key or URL.
  - Figma API token (`FIGMA_ACCESS_TOKEN` or `--token`).
  - Output directory for per‑component JSON.
- Behavior:
  - Fetches the Figma file via `https://api.figma.com`.
  - Walks the document tree, finding `COMPONENT_SET` nodes (component sets).
  - Filters out “hidden” component sets (names starting with `_`/`.`, or that sanitize to `_`).
  - For each component set:
    - Extracts variants and variant properties.
    - Normalizes variant keys/values and computes enum shapes.
    - Extracts component property definitions and references.
    - Computes a stable checksum.
  - Writes `superconnect/figma-components/<slug>.json`.
  - Writes `superconnect/figma-components-index.json` summarizing the file and components.

### 3. Orienter (`scripts/run-orienter.js`)

- Inputs:
  - `superconnect/figma-components-index.json`
  - `superconnect/repo-summary.json`
  - Agent backend, model, and max tokens (from CLI and `superconnect.toml`).
- Behavior:
  - Reads the orienter prompt (`prompts/orienter.md`).
  - Builds a payload with:
    - Prompt text.
    - Pretty‑printed Figma index JSON.
    - Pretty‑printed repo summary JSON.
  - Calls the configured agent via `AgentAdapter.orient`.
  - Streams agent stdout into:
    - `superconnect/orientation.jsonl` (one JSON object per component).
    - A log file under `superconnect/orienter-agent.log`.
- Position in pipeline:
  - Executed immediately before codegen and grouped with codegen in run output/log coloring to reflect it as part of the generation phase.
- Output data model (per line, JSON):
  - `figma_component_id`, `figma_component_name`
  - `status`: `"mapped" | "missing" | "ambiguous"`
  - `confidence`: `0.0–1.0`
  - `files`: array of repo‑relative file paths
  - `notes`: brief explanation

### 4. Codegen (`scripts/run-codegen.js`)

- Inputs:
  - `superconnect/figma-components-index.json`
  - `superconnect/figma-components/*.json`
  - `superconnect/orientation.jsonl`
  - Agent backend configuration (same as Orienter).
- Behavior per oriented component:
  - Normalize the orienter record (ID/name fields, file lists).
  - Resolve the Figma component’s per-component JSON.
  - Read the selected source files from the target repo.
  - Build an agent payload:
    - Schema-mapping prompt (`prompts/react-mapping-agent.md` for React, `prompts/angular-mapping-agent.md` for Angular).
    - Compact Figma metadata (component set, variants, properties).
    - Orientation info.
    - Inlined source file contents.
  - Call `AgentAdapter.codegen` to get a JSON mapping schema.
  - Normalize the React import path against the file system.
  - Render a `.figma.tsx` file from the mapping schema, Figma properties, and example props.
  - Write:
    - `codeConnect/<Component>.figma.tsx` (unless skipped or blocked by existing file and no `--force`).
    - `superconnect/codegen-logs/*-codegen-result.json` (per‑component summary).
- Codegen respects:
  - `--only` / `--exclude` filters (names/IDs/globs).
  - `--force` for overwriting existing mapping files.

### 5. Finalizer (`scripts/finalize.js`)

- Inputs:
  - `superconnect/figma-components-index.json`
  - `superconnect/orientation.jsonl`
  - `superconnect/codegen-logs/*.json`
  - `codeConnect/*.figma.tsx`
- Behavior:
  - Correlates Figma components with codegen results.
  - Builds a summary of:
    - Figma scanning (file metadata, component counts).
    - Repo scanning and orientation coverage.
    - Codegen successes and skips (with reasons).
  - Prints a colorized run summary to stdout.
  - Creates/overwrites `figma.config.json` at the target repo root with:
    - `include`/`exclude` globs for Code Connect files and source.
    - Parser and label.
    - Optional `interactiveSetupFigmaFileUrl`.
    - `documentUrlSubstitutions` mapping per‑component tokens (e.g., `<FIGMA_BUTTON>`) to live Figma node URLs.

## Configuration and assumptions

- **Config file**: `superconnect.toml`
  - `[inputs]` – `figma_url`, `component_repo_path`.
  - `[agent]` – `backend`, `sdk_model`, `max_tokens`.
  - Parsed via a lightweight TOML parser that supports:
    - Top‑level keys.
    - Single‑level sections.
    - Comments (`#`) trailing on lines.
- **Environment variables**
  - `FIGMA_ACCESS_TOKEN` – required for Figma scan (or `--figma-token`).
  - `ANTHROPIC_API_KEY` – for Claude backend.
  - `OPENAI_API_KEY` – for OpenAI backend.

Assumptions:
- Target repos are React/TypeScript projects with components under conventional roots (`src/components`, `packages/*/src/components`, etc.).
- The mapping between Figma components and React components can be expressed as:
  - A single import path and component name.
  - A finite set of props expressed as enums/booleans/strings/instances.

## Integrations

- **Figma API**
  - Used only by `scripts/figma-scan.js`.
  - Accessed via `undici.fetch` with `X-Figma-Token` header.
- **Figma Code Connect**
  - Consumes:
    - `codeConnect/*.figma.tsx` files generated by Superconnect.
    - `figma.config.json` produced by the Finalizer, including document URL substitutions.
- **LLM backends**
  - OpenAI Responses API and Anthropic Claude SDK provide:
    - Repository orientation (Stage 3).
    - Mapping schemas (Stage 4).
