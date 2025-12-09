# Testing Superconnect

This repo has fast unit tests and an optional end-to-end (E2E) validation against the ZapUI Angular design system

## Prerequisites

- Node 18+ installed
- Dependencies installed in this repo: `npm install`
- Optional but recommended: `.env` in repo root containing
  - `FIGMA_ACCESS_TOKEN=...`
  - `ANTHROPIC_API_KEY=...`

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
  - `https://www.figma.com/design/GqZ6Bvsu8w8q2ukS1FDPX7/Zap-UI-Kit--Community-?m=auto&t=GVF9lkWuNBY6BgRq-6`
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

- Enable verbose mode via npm config flag
  - `npm run test:e2e:zapui --zapui-e2e-verbose=true`
- Or pass Jest’s `--verbose` flag through npm
  - `npm run test:e2e:zapui -- --verbose`
- Or use an environment variable
  - `ZAPUI_E2E_VERBOSE=1 npm run test:e2e:zapui`

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.ts`, `superconnect/*`, logs)
  - Temporarily comment out the `fs.removeSync(tmpDir)` call at the end of `test/zapui-e2e.test.js`
  - Add a `console.log(tmpDir)` near where `tmpDir` is created
  - Re-run the test, then manually inspect that directory
