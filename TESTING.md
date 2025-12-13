# Testing Superconnect

This repo has fast unit tests and optional end-to-end (E2E) validations against real design systems.

## Testing strategy and motivation

Superconnect sits between two live systems (a component repo and a Figma file) and relies on LLMs for orientation and mapping, so we test at two layers.

- Unit tests give fast, deterministic coverage of the pipeline logic and helpers
  - These are what CI runs on every change
  - They protect core behavior like parsing, normalization, heuristics, and rendering
- E2E tests validate the full pipeline against real design systems
  - They catch integration issues we cannot see in fixtures alone (Figma metadata shape changes, CLI expectations, agent output drift)
  - They require network access and tokens, so they are opt‑in

We also use Chakra React E2E to create a quality benchmark for React codegen.

- We gather benchmark metrics, which are numeric summaries of a run (how many mappings built, how many skipped, JSON validity, internal import count, token coverage)
- We check this into the repo in the form of a metrics file that sets the floor for code-gen quality
- Then we can guard against regressions by failing tests if metrics drop (which can happen because of, for example, LLM model changes)

## How to run all tests

- Core unit suite (what CI should run)
  - `npm test`
- Optional live E2E suites (run manually when you want full coverage)
  - Chakra React
    - Small subset: `npm run test:e2e:chakra:small`
    - Full suite: `npm run test:e2e:chakra`
    - Record benchmark baseline: `npm run test:e2e:chakra:record`
    - Keep artifacts (full): `npm run test:e2e:chakra:keep`
    - Keep artifacts (small): `npm run test:e2e:chakra:small:keep`
  - ZapUI Angular
    - Small subset: `npm run test:e2e:zapui:small`
    - Full suite: `npm run test:e2e:zapui`
    - Keep artifacts (full): `npm run test:e2e:zapui:keep`
    - Keep artifacts (small): `npm run test:e2e:zapui:small:keep`
  - These require Figma + agent tokens and network access
    - `FIGMA_ACCESS_TOKEN=...`
    - `ANTHROPIC_API_KEY=...`
  - E2E tests first look in `process.env`, then fall back to `.env` in this repo root for those values
  - Advanced knobs (prefer npm scripts first)
    - `CHAKRA_E2E_ONLY` (example: `Button`)
    - `CHAKRA_E2E_RECORD=1` to record a new benchmark baseline
    - `CHAKRA_E2E_KEEP=1` to keep the temp directory
    - `ZAPUI_E2E_ONLY` (example: `Button`)
    - `ZAPUI_E2E_KEEP=1` to keep the temp directory
    - `SUPERCONNECT_E2E_VERBOSE=1` to echo child commands and output
  - CI policy
    - CI runs unit tests on every push
    - When secrets are available on `main`, CI runs only the small E2E suites to reduce runtime and flake
    - Full live E2E runs are intended for developers to run locally

## Unit tests

- Test runner
  - Jest, configured via `npm test`
- Location
  - Test files live in `test/` alongside the pipeline and helper scripts they cover
- Scope
  - Agent adapters, framework detection and plumbing
  - Angular-specific behavior (component discovery, stubs, figma.config.json, fallback URLs)
  - React/Angular codegen filters (e.g., prop handling, `--only` filtering)
- Running
  - Run the full unit suite: `npm test`
  - Watch mode for local development: `npm run test:watch`

## ZapUI E2E validation

The ZapUI E2E test runs the full Superconnect pipeline against the real ZapUI Angular repo and Figma file, then validates the generated Code Connect files via the Figma CLI

### What it does

- Uses the ZapUI git submodule at `fixtures/zapui` (remote `git@github.com:zapuilib/zapui.git`)
- Copies ZapUI into a temporary directory under your OS temp folder
- Writes a `superconnect.toml` that points to the Zap UI Kit Figma file
  - `https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit--Bitovi---Copy-?m=auto&t=0XdgVxllEy8vO4w1-6`
- Runs the full pipeline for Angular
  - Full run: `node scripts/run-pipeline.js --framework angular --force`
  - Optional subset: `node scripts/run-pipeline.js --framework angular --force --only <subset>`
- Runs Figma Code Connect validation in the temp ZapUI copy
  - `figma connect parse`
  - `figma connect publish --dry-run`
- Cleans up the temp directory when the test finishes

### One-time setup

- Initialize the ZapUI submodule
  - `git submodule update --init fixtures/zapui`
- Ensure Figma and agent tokens are available
  - Either export `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY`
  - Or put them in `.env` in this repo root
- When creating your Figma access token, enable at least
  - Files: `file_content:read`
  - Development: `file_code_connect:write`, `file_dev_resources:read`, `file_dev_resources:write`

### Running the E2E test

- Standard run
  - `npm run test:e2e:zapui`
- Small run (fast subset)
  - `npm run test:e2e:zapui:small`
- This will
  - Gate on `RUN_ZAPUI_E2E=1` via the npm script
  - Use your FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY from env or `.env`
  - Make live calls to the Figma API and the configured agent backend

### Verbose output

The ZapUI E2E test can print each child command and its combined stdout/stderr

- Verbose small run
  - `npm run test:e2e:zapui:small:verbose`
- Verbose full run (advanced)
  - `SUPERCONNECT_E2E_VERBOSE=1 npm run test:e2e:zapui`

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.ts`, `superconnect/*`, logs)
  - Full run: `npm run test:e2e:zapui:keep`
  - Small run: `npm run test:e2e:zapui:small:keep`
  - The test prints the temp directory path when keep is enabled

## Chakra UI React E2E validation

The Chakra E2E test runs the full Superconnect pipeline against the Chakra UI React repo and Figma file, then validates via the Figma CLI

### What it does

- Uses the Chakra UI git submodule at `fixtures/chakra-ui` (remote `https://github.com/chakra-ui/chakra-ui`)
- Copies Chakra UI into a temporary directory under your OS temp folder
- Writes a `superconnect.toml` that points to the Chakra UI Figma file
  - `https://www.figma.com/design/7jkNETbphjIb9ap1M7H1o4/Chakra-UI----Figma-Kit--v3---Community-?m=auto&t=0XdgVxllEy8vO4w1-6`
- Runs the full pipeline for React
  - Full run by default (all oriented components)
  - Optional subset run when `CHAKRA_E2E_ONLY` is set
  - `node scripts/run-pipeline.js --framework react --force [--only <subset>]`
- Runs Figma Code Connect validation in the temp copy
  - `figma connect parse`
  - `figma connect publish --dry-run`
- Computes benchmark metrics from outputs and compares to a baseline to prevent regressions
- Cleans up the temp directory when the test finishes

### One-time setup

- Initialize the Chakra UI submodule
  - `git submodule update --init fixtures/chakra-ui`
- Ensure Figma and agent tokens are available
  - Either export `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY`
  - Or put them in `.env` in this repo root
- When creating your Figma access token, enable at least
  - Files: `file_content:read`
  - Development: `file_code_connect:write`, `file_dev_resources:read`, `file_dev_resources:write`

### Component subset

- Full run (recommended for benchmarking, local only)
  - Do not set `CHAKRA_E2E_ONLY`
  - Generates for all Chakra components and enforces the benchmark ratchet
- Subset run (recommended for fast iteration)
  - Run `npm run test:e2e:chakra:small` or set `CHAKRA_E2E_ONLY` to a comma separated list of Figma component names
  - Example: `CHAKRA_E2E_ONLY="Button,Steps.Indicator" npm run test:e2e:chakra`
  - Subset runs skip the ratchet so they do not fail due to fewer built files

### Running the E2E test

- Standard run
  - `npm run test:e2e:chakra`
- This will
  - Gate on `RUN_CHAKRA_E2E=1` via the npm script
  - Use your FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY from env or `.env`
  - Make live calls to the Figma API and the configured agent backend

### Verbose output

The Chakra E2E test can print each child command and its combined stdout/stderr

- Verbose small run
  - `npm run test:e2e:chakra:small:verbose`
- Verbose full run (advanced)
  - `SUPERCONNECT_E2E_VERBOSE=1 npm run test:e2e:chakra`

### Benchmark ratchet and baselines

The Chakra E2E suite is also our hill climbing benchmark for React codegen quality and includes a ratchet (non‑regression) check

- Metrics are printed at the end of a run as `CHAKRA_BENCH_METRICS: {...}`
  - Includes counts for built vs skipped, connector files, invalid JSON, internal imports, placeholder token coverage, and a few quality signals
- The baseline lives at `test/baselines/chakra-metrics.json`
  - Local full runs compare current metrics to this file with small tolerances for LLM nondeterminism
- CI runs subset E2E, which skips the ratchet
- To record a new baseline after an improvement
  - `npm run test:e2e:chakra:record`
- To keep the temp directory for inspection
  - Full run: `npm run test:e2e:chakra:keep`
  - Small run: `npm run test:e2e:chakra:small:keep`

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.tsx`, `superconnect/*`, logs)
  - Full run: `npm run test:e2e:chakra:keep`
  - Small run: `npm run test:e2e:chakra:small:keep`
  - The test prints the temp directory path when keep is enabled
