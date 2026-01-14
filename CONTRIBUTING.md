# Contributing to Superconnect

## Big picture

- CLI entrypoint is `scripts/run-pipeline.js`, exposed as the `superconnect` binary
- Each pipeline stage in the pipeline is implemented as a Node scripts in `scripts/`, with some helpers in `src/`
- Configuration and high‑level behavior are documented under `docs/` and these are also key inputs for coding agents. (AGENTS.md instructs agents to go read them.)
- Tests and fixtures live under `test/` and `fixtures/`, and closely mirror the pipeline stages

For a conceptual overview of what Superconnect does and why, start with:

- `docs/PRODUCT-VISION.md` for goals and problem framing
- `docs/ARCHITECTURE.md` for an overview of the pipeline
- `README.md` for how a user runs the CLI end to end

## Where things live

### Scripts (CLI entrypoints)

The `scripts/` directory contains the executable pieces of the pipeline:

- `scripts/run-pipeline.js`  
  Orchestrates the full run  
  Parses CLI flags, loads `superconnect.toml`, infers frameworks, and calls the individual stages

- `scripts/summarize-repo.js`  
  Stage 1: repo summarizer  
  Scans a React or Angular repo, detects frameworks, finds component roots, and writes `superconnect-logs/repo-summary.json`

- `scripts/figma-scan.js`  
  Stage 2: Figma scan  
  Talks to the Figma API, extracts component metadata, and writes `superconnect-logs/figma-components-index.json` plus per‑component JSON

- `scripts/run-orienter.js`  
  Stage 3: orienter  
  Builds the orienter payload (prompt + Figma index + repo summary + target framework), calls the LLM via adapters, and writes `superconnect-logs/orientation.jsonl`

- `scripts/run-codegen.js`  
  Stage 4: codegen  
  Reads Figma metadata, orientation output, repo summary, and prompts, then asks the LLM to produce mappings and renders:
  - React `.figma.tsx` files
  - Angular `.figma.ts` files (using `lit-html` templates)
  Also writes per‑component summaries in `superconnect-logs/codegen-summaries/`

- `scripts/finalize.js`  
  Stage 5: finalizer  
  Reads the artifacts from earlier stages and prints a colorized run summary, plus writes `figma.config.json` with appropriate include globs and parser/label for React or Angular

## Core library code

Most reusable logic lives under `src/`:

- `src/agent/agent-adapter.js`  
  Adapters for LLM backends  
  Wraps the Anthropic and OpenAI SDKs and exposes a common interface:
  - `orient({ payload, logLabel, outputStream, logDir })`
  - `codegen({ payload, logLabel, cwd, logDir })`

- `src/util/detect-framework.js`  
  Framework detection helpers  
  Looks at `package.json`, file patterns, and imports to infer:
  - `frameworks` (e.g., `["react", "angular"]`)
  - `primaryFramework` (used to choose prompts, outputs, and finalize behavior)

- `src/util/scan-angular.js`  
  Angular component discovery  
  Finds `.component.ts` files, extracts selectors and class names, associates them with:
  - Module files (`*.module.ts`)
  - Templates (`*.html`)
  This data is written into `repo-summary.json` as `angular_components` and reused by Angular codegen

- `scripts/colors.js`  
  Shared color utilities for CLI output (used by pipeline scripts for consistent formatting)

## Prompts and agent contracts

Prompts live in `prompts/` and define how the agents should behave:

- `prompts/orienter.md`  
  Instructions for the orienter stage, describing how to map Figma components to source files

- `prompts/react-direct-codegen.md`  
  Direct codegen prompt for React, teaches agents the Code Connect API and how to generate `.figma.tsx` files

- `prompts/angular-direct-codegen.md`  
  Direct codegen prompt for Angular, teaches agents the Code Connect API and how to generate `.figma.ts` files

- `prompts/figma-code-connect-react.md`  
  Reference documentation for Figma's Code Connect React API

- `prompts/figma-code-connect-html.md`  
  Reference documentation for Figma's Code Connect HTML/Angular API

To understand why the agent produced a particular mapping, look at:

- The relevant prompt in `prompts/`
- The agent logs in `superconnect-logs/orienter-agent.log`, `superconnect-logs/codegen-summaries/*.json`, and `superconnect-logs/codegen-agent-transcripts/*.log`

## Tests and fixtures

- **Unit tests** (`test/*.test.js`) - Fast validation of pipeline logic
- **E2E tests** (`test/*-e2e.test.js`) - Full integration with Chakra UI and ZapUI fixtures
- **Fixtures** (`fixtures/`) - Sample repos for testing React and Angular behaviors

See `docs/TESTING.md` for test commands and debugging.

## Configuration

- `superconnect.toml` - Config file in target repo (Figma URL, agent backend)
- Environment variables - `FIGMA_ACCESS_TOKEN` and AI provider keys

See `README.md` for configuration details.

