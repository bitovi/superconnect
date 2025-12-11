# Testing Superconnect

This repo has fast unit tests and optional end-to-end (E2E) validations against real design systems

## How to run all tests

- Core unit suite (what CI should run)
  - `npm test`
- Optional live E2E suites (run manually when you want full coverage)
  - `npm run test:e2e:zapui` for Angular (ZapUI)
  - `npm run test:e2e:chakra` for React (Chakra UI)
  - These require Figma + agent tokens and network access
    - `FIGMA_ACCESS_TOKEN=...`
    - `ANTHROPIC_API_KEY=...`
  - E2E tests first look in `process.env`, then fall back to `.env` in this repo root for those values

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
  - `node scripts/run-pipeline.js --framework angular --force`
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

### Running the E2E test

- Standard run
  - `npm run test:e2e:zapui`
- This will
  - Gate on `RUN_ZAPUI_E2E=1` via the npm script
  - Use your FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY from env or `.env`
  - Make live calls to the Figma API and the configured agent backend

### Verbose output

The ZapUI E2E test can print each child command and its combined stdout/stderr

- Enable command echoing with an env var
  - `SUPERCONNECT_E2E_VERBOSE=1 npm run test:e2e:zapui`

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.ts`, `superconnect/*`, logs)
  - Temporarily comment out the `fs.removeSync(tmpDir)` call at the end of `test/zapui-e2e.test.js`
  - Add a `console.log(tmpDir)` near where `tmpDir` is created
  - Re-run the test, then manually inspect that directory

## Chakra UI React E2E validation

The Chakra E2E test runs the full Superconnect pipeline against the Chakra UI React repo and Figma file, then validates via the Figma CLI

### What it does

- Uses the Chakra UI git submodule at `fixtures/chakra-ui` (remote `https://github.com/chakra-ui/chakra-ui`)
- Copies Chakra UI into a temporary directory under your OS temp folder
- Writes a `superconnect.toml` that points to the Chakra UI Figma file
  - `https://www.figma.com/design/ZB8OpbBRORzvomAMC6pZtW/Chakra-UI-Figma-Kit--Community-?m=auto&t=0XdgVxllEy8vO4w1-6`
- Runs the full pipeline for React, limited to a small component subset via `--only`
  - `node scripts/run-pipeline.js --framework react --force --only <subset>`
- Runs Figma Code Connect validation in the temp copy
  - `figma connect parse`
  - `figma connect publish --dry-run`
- Cleans up the temp directory when the test finishes

### One-time setup

- Initialize the Chakra UI submodule
  - `git submodule update --init fixtures/chakra-ui`
- Ensure Figma and agent tokens are available
  - Either export `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY`
  - Or put them in `.env` in this repo root

### Component subset

- Default subset (~10 components): Button, Input, Checkbox, Switch, Select, Tabs.List, Tabs.Trigger, Accordion, Tooltip, Card
- Override via env or npm config: `CHAKRA_E2E_ONLY="Button,Input,..."`
  - Example: `CHAKRA_E2E_ONLY="Button,Input,Checkbox" npm run test:e2e:chakra`

### Running the E2E test

- Standard run
  - `npm run test:e2e:chakra`
- This will
  - Gate on `RUN_CHAKRA_E2E=1` via the npm script
  - Use your FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY from env or `.env`
  - Make live calls to the Figma API and the configured agent backend

### Verbose output

The Chakra E2E test can print each child command and its combined stdout/stderr

- Enable command echoing with an env var
  - `SUPERCONNECT_E2E_VERBOSE=1 npm run test:e2e:chakra`

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.tsx`, `superconnect/*`, logs)
  - Temporarily comment out the `fs.removeSync(tmpDir)` call at the end of `test/chakra-e2e.test.js`
  - Add a `console.log(tmpDir)` near where `tmpDir` is created
  - Re-run the test, then manually inspect that directory
