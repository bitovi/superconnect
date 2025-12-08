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
  Scans a React or Angular repo, detects frameworks, finds component roots, and writes `superconnect/repo-summary.json`

- `scripts/figma-scan.js`  
  Stage 2: Figma scan  
  Talks to the Figma API, extracts component metadata, and writes `superconnect/figma-components-index.json` plus per‑component JSON

- `scripts/run-orienter.js`  
  Stage 3: orienter  
  Builds the orienter payload (prompt + Figma index + repo summary + target framework), calls the LLM via adapters, and writes `superconnect/orientation.jsonl`

- `scripts/run-codegen.js`  
  Stage 4: codegen  
  Reads Figma metadata, orientation output, repo summary, and prompts, then asks the LLM to produce mappings and renders:
  - React `.figma.tsx` files
  - Angular `.figma.ts` files (using `lit-html` templates)
  Also writes per‑component logs in `superconnect/codegen-logs/`

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

- `src/colors.js`  
  Shared color utilities for CLI output (used by pipeline scripts for consistent formatting)

## Prompts and agent contracts

Prompts live in `prompts/` and define how the agents should behave:

- `prompts/orienter.md`  
  Instructions for the orienter stage, describing how to map Figma components to source files

- `prompts/react-mapping-agent.md`  
  Mapping schema contract for React codegen, including expectations for imports, props, and examples

- `prompts/angular-mapping-agent.md`  
  Mapping schema contract for Angular codegen, including selectors, inputs, and template usage

- `prompts/single-codegen.md`  
  A focused prompt used in some tests and experiments for isolated mapping runs

To understand why the agent produced a particular mapping, look at:

- The relevant prompt in `prompts/`
- The agent logs in `superconnect/orienter-agent.log` and `superconnect/mapping-agent-logs/`

## Tests and fixtures

The test suite is organized to mirror the pipeline and framework support:

- `test/*.test.js`  
  Jest tests exercising:
  - Agent adapters (`agent-adapter.test.js`)
  - Framework detection and plumbing (`framework-detection.test.js`, `framework-plumbing.test.js`)
  - React mapping and edge cases (`react-orienter.test.js`, `react-hyphen-prop.test.js`)
  - Angular discovery and codegen (`angular-component-discovery.test.js`, `angular-codegen-stub.test.js`, `angular-orienter.test.js`, `angular-figma-config.test.js`, `angular-fallback-url-token.test.js`)
  - Filters and CLI options (`codegen-only-filter.test.js`)

- `fixtures/`  
  Small sample repos and precomputed artifacts used by tests:
  - `fixtures/react-sample/` and `fixtures/react-hyphen/` for React behaviors
  - `fixtures/angular-sample/` for Angular behaviors, selectors, and `figma.config.json`
  - `fixtures/only-filter/` for exercising `--only` / `--exclude` logic
  Each fixture usually contains a `superconnect/` directory with:
  - `repo-summary.json`
  - `figma-components-index.json`
  - Orientation/mapping fixtures used as stand‑ins for live runs

To see realistic end‑to‑end output without hitting Figma or LLM APIs, browse the fixtures and their `superconnect/` subdirectories

## Configuration and environment

Configuration is mostly driven from a config file that's generated if it isn't found. Environment variables are only used for secrets. 

- `superconnect.toml`  
  Small config file that lives in the target repo and tells Superconnect where to run and which agent backend to use:
  - `[inputs]` contains `figma_url` and `component_repo_path`
  - `[agent]` selects backend and model

- Environment variables  
  - `FIGMA_ACCESS_TOKEN` for `scripts/figma-scan.js`
  - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for the agent adapters

When those values are missing, `scripts/run-pipeline.js` will either:

- Prompt you to create `superconnect.toml`, or
- Refuse to run agent stages unless you use `--dry-run`

