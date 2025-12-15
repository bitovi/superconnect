# Testing Superconnect

This repo has fast unit tests and optional end-to-end (E2E) validations against real design systems.

## Quickstart

```bash
# Run all unit tests (fast, no network required)
npm test

# Watch mode for TDD
npm run test:watch

# Run specific test file
npm test -- test/react-direct-codegen.test.js

# E2E tests (requires tokens, see Prerequisites)
npm run test:e2e:chakra:small      # Chakra React (Button only)
npm run test:e2e:zapui:small       # ZapUI Angular (Button only)
```

## Prerequisites

**Required:**
- Node.js ≥ 20.0.0
- Dependencies installed: `npm install`

**For E2E tests only:**
- `FIGMA_ACCESS_TOKEN` with scopes:
  - Files: `file_content:read`
  - Development: `file_code_connect:write`, `file_dev_resources:read`, `file_dev_resources:write`
- `ANTHROPIC_API_KEY` (for Claude backend)
- Git submodules initialized: `git submodule update --init fixtures/chakra-ui fixtures/zapui`

Set tokens in `.env` at repo root or export as environment variables.

## Test Suites

### Unit Tests (test/*.test.js)

**Scope:**
- Agent adapters (OpenAI, Claude SDK integration)
- Framework detection (React, Angular repo identification)
- Codegen logic (React/Angular direct codegen, validation, retry)
- Parsing (TOML config, JSONL orientation, export extraction)
- Filtering (`--only`, `--exclude` flags)
- Angular-specific (component discovery, selector extraction, template stubs)
- React-specific (prop handling, variant mapping, enum canonicalization)

**Coverage:**
- ~30 test files covering core pipeline logic
- Tests run with Jest, no network calls, deterministic
- All tests use fixtures in `fixtures/` directory

**What CI runs:**
- Full unit suite on every push
- Fast (< 10 seconds), no secrets required
- Full E2E suites on main branch commits (~3.5 min total when secrets available)

### E2E Tests (test/chakra-e2e.test.js, test/zapui-e2e.test.js)

**Scope:**
- Full pipeline against real Chakra UI (React) and ZapUI (Angular) repos
- Live Figma API calls
- Live LLM calls (orientation + codegen)
- Validation via `figma connect parse` and `figma connect publish --dry-run`
- Benchmark metrics tracking

**What they catch:**
- Figma API shape changes
- Agent output format drift
- CLI integration issues
- Real-world edge cases not covered by fixtures

**What CI runs:**
- Full E2E suites on main branch commits (Chakra ~2.5min, ZapUI ~45sec)
- Small subsets on feature branches (Button only) when secrets available

## Testing Strategy

Superconnect sits between two live systems (Figma + component repos) and relies on LLMs, so we test at two layers:

1. **Unit tests** - Deterministic, fast coverage of pipeline logic
   - Protect core behavior: parsing, normalization, rendering
   - Run on every CI build
   - Use static fixtures, no network

2. **E2E tests** - Live integration validation
   - Catch issues unit tests can't see
   - Require tokens and network access
   - Opt-in for developers, small subsets in CI

## Running Tests

### All Unit Tests

```bash
npm test
```

### Watch Mode (TDD)

```bash
npm run test:watch
```

### Single Test File

```bash
npm test -- test/framework-detection.test.js
```

### Filter by Test Name

```bash
npm test -- -t "validates react component"
```

### E2E: Chakra UI (React)

**⚠️ Important for Coding Agents:**
- **ALWAYS use the npm scripts** (`npm run test:e2e:chakra:small`), not `npm test -- chakra-e2e`
- **DO NOT** try to run Jest directly with environment variables like `RUN_CHAKRA_E2E=1 npm test chakra-e2e`
- **DO NOT** run tests in background with `&` or `nohup` - they take 2-3 minutes, just wait
- The tests will automatically load `.env` from the repo root
- Check test results in Jest's final output, not intermediate "RUNS" messages

```bash
# Small subset (Button only, ~2 min)
npm run test:e2e:chakra:small

# Full suite (all components, ~2.5 min)
npm run test:e2e:chakra

# Keep artifacts for inspection
npm run test:e2e:chakra:small:keep

# Verbose output (shows all child commands)
npm run test:e2e:chakra:small:verbose
```

**Subset control:**
```bash
# Custom component list
CHAKRA_E2E_ONLY="Button,Alert,Badge" npm run test:e2e:chakra
```

### E2E: ZapUI (Angular)

**⚠️ Important for Coding Agents:**
- **ALWAYS use the npm scripts** (`npm run test:e2e:zapui:small`), not `npm test -- zapui-e2e`
- **DO NOT** try to run Jest directly with environment variables
- The tests will automatically load `.env` from the repo root
- ZapUI tests are typically faster (~45 sec) than Chakra tests

```bash
# Small subset (Button only, ~2 min)
npm run test:e2e:zapui:small

# Full suite (all components, ~45 sec)
npm run test:e2e:zapui

# Keep artifacts for inspection
npm run test:e2e:zapui:small:keep

# Verbose output
npm run test:e2e:zapui:small:verbose
```

**Subset control:**
```bash
# Custom component list
ZAPUI_E2E_ONLY="Button,Alert" npm run test:e2e:zapui
```

## Repository Conventions

### Test Organization

```
test/
├── *-e2e.test.js           # E2E tests (require tokens)
├── agent-adapter.test.js   # Agent SDK integration
├── angular-*.test.js       # Angular-specific logic
├── react-*.test.js         # React-specific logic
├── framework-*.test.js     # Framework detection
├── codegen-*.test.js       # Codegen filtering/logic
├── validate-*.test.js      # Validation layer
└── util/                   # Test helpers
```

### Naming Conventions

- Test files: `{feature}.test.js` (e.g., `react-direct-codegen.test.js`)
- E2E tests: `{system}-e2e.test.js` (e.g., `chakra-e2e.test.js`)
- Describe blocks: Feature or module name
- Test names: Imperative ("validates X", "generates Y"), not "should validate X"

### Fixtures

```
fixtures/
├── react-sample/           # Minimal React fixtures
├── angular-sample/         # Minimal Angular fixtures
├── react-{feature}/        # Feature-specific React fixtures
├── chakra-ui/              # Git submodule (E2E only)
└── zapui/                  # Git submodule (E2E only)
```

**Fixture structure:**
```
fixtures/{name}/
├── superconnect/
│   ├── figma-components-index.json  # Figma metadata
│   ├── figma-components/*.json      # Per-component data
│   ├── orientation.jsonl            # Expected orienter output
│   └── repo-summary.json            # Repo analysis
├── src/                             # Sample source files
├── codeConnect/                     # Expected outputs
└── figma.config.json                # Expected config
```

### Adding New Tests

1. **Unit test for new feature:**
   ```javascript
   // test/my-feature.test.js
   const { myFunction } = require('../src/util/my-feature');
   
   describe('myFunction', () => {
     test('handles edge case', () => {
       expect(myFunction('input')).toBe('output');
     });
   });
   ```

2. **Create fixture if needed:**
   ```bash
   mkdir -p fixtures/my-feature/{src,superconnect,codeConnect}
   # Add minimal repro files
   ```

3. **Run your test:**
   ```bash
   npm test -- test/my-feature.test.js
   ```

## Determinism and Reliability

### Unit Tests

**Always deterministic** - no randomness, time dependencies, or network calls.

- Use static fixtures (checked into git)
- Mock time if needed (Jest fake timers)
- Mock file system when appropriate (fs-extra operations are real in tests)

### E2E Tests

**Intentionally non-deterministic** - validates against live systems.

**Expected variability:**
- LLM output wording changes (we validate structure, not exact text)
- Figma API response times
- Network latency

**Flake policy:**
- E2E tests are opt-in (not blocking CI by default)
- Small subsets in CI catch regressions without full flake surface
- If E2E test flakes repeatedly, investigate:
  1. Is the flake in our code or external system?
  2. Can we add retry logic or looser assertions?
  3. Should this check move to a unit test?

**Avoiding flake:**
- E2E tests use `SUPERCONNECT_E2E_VERBOSE=1` for debugging
- Tests clean up temp directories in `finally` blocks
- Use `--keep` variants to inspect artifacts when debugging

### Time and Randomness

- No `Math.random()` in unit tests
- No `new Date()` without mocking (use Jest fake timers if needed)
- Deterministic sorting (always specify comparator for arrays)

### Network Isolation

- Unit tests: **Zero network calls** (all data from fixtures)
- E2E tests: **Controlled network** (only to Figma API and agent backends)

## CI Policy

**On every push:**
- All unit tests (`npm test`)
- Fast (< 10 seconds), deterministic, no secrets required

**On `main` branch commits with secrets:**
- Full E2E test suites (Chakra UI + ZapUI)
- Runtime: ~3.5 min total (Chakra ~2.5min, ZapUI ~45sec with concurrency=8)
- Validates against live Figma API and LLM backends
- Requires `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY` secrets

**Local development:**
- Run small E2E subsets for fast iteration (`npm run test:e2e:chakra:small`)
- Run full E2E before submitting PRs to validate changes

## Debugging Failed Tests

### Unit Test Failures

1. **Run single test file:**
   ```bash
   npm test -- test/failing-test.test.js
   ```

2. **Run specific test by name:**
   ```bash
   npm test -- -t "exact test name"
   ```

3. **Add `console.log` and re-run** - Jest shows all output

4. **Check fixtures** - Verify input data in `fixtures/{name}/`

### E2E Test Failures

1. **Keep artifacts for inspection:**
   ```bash
   npm run test:e2e:chakra:small:keep
   ```
   Temp directory path printed in test output.

2. **Enable verbose output:**
   ```bash
   npm run test:e2e:chakra:small:verbose
   ```
   Shows all child commands and stdout/stderr.

3. **Check logs:**
   ```
   {tempDir}/superconnect/
   ├── orienter-agent.log          # Orientation LLM calls
   ├── mapping-agent-logs/*.log    # Codegen LLM calls
   ├── codegen-logs/*.json         # Per-component results
   └── orientation.jsonl           # Orienter decisions
   ```

4. **Validate generated files manually:**
   ```bash
   cd {tempDir}
   figma connect parse
   ```

5. **Check for API changes:**
   - Figma API might have changed structure
   - LLM output format might have drifted
   - Compare to working baseline in previous commits

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

- Full run
  - Do not set `CHAKRA_E2E_ONLY`
  - Generates for all Chakra components
- Subset run (recommended for fast iteration)
  - Run `npm run test:e2e:chakra:small` or set `CHAKRA_E2E_ONLY` to a comma separated list of Figma component names
  - Example: `CHAKRA_E2E_ONLY="Button,Steps.Indicator" npm run test:e2e:chakra`

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

### Inspecting artifacts

By default the E2E test deletes its temp directory in a `finally` block

- To inspect outputs (generated `codeConnect/*.figma.tsx`, `superconnect/*`, logs)
  - Full run: `npm run test:e2e:chakra:keep`
  - Small run: `npm run test:e2e:chakra:small:keep`
  - The test prints the temp directory path when keep is enabled
