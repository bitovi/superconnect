# Testing Superconnect

Fast unit tests + optional E2E validations against real design systems.

## Quickstart

```bash
# Unit tests (fast, no tokens needed)
pnpm test

# E2E tests (requires tokens - see Prerequisites)
pnpm run test:e2e:chakra:small    # Chakra React (Button only, ~2 min)
pnpm run test:e2e:zapui:small     # ZapUI Angular (Button only, ~2 min)
```

## Prerequisites

**Unit tests:** Node.js ≥ 22.0.0 + `pnpm install`

**E2E tests (optional):**
- `FIGMA_ACCESS_TOKEN` (scopes: `file_content:read`, `file_code_connect:write`, `file_dev_resources:read/write`)
- `ANTHROPIC_API_KEY`
- Git submodules: `git submodule update --init fixtures/chakra-ui fixtures/zapui`

Set tokens in `.env` at repo root.

## Test Suites

### Unit Tests

**Coverage:**
- Agent adapters, framework detection, codegen logic
- Validation, parsing, filtering
- React/Angular-specific behavior

**Characteristics:**
- ~56 tests across 7 suites
- Deterministic, no network calls
- Uses fixtures in `fixtures/`
- Runs in ~4 seconds

### E2E Tests

**Coverage:**
- Full pipeline against Chakra UI (React) and ZapUI (Angular)
- Live Figma API + LLM calls
- Figma CLI validation
- AST validation of ALL generated mappings
- Specific mapping assertions for regression detection

**What they catch:**
- Figma API changes
- LLM output format drift
- Prompt regressions (e.g., "size" → "buttonSize")
- CLI integration issues

## Testing Strategy
## Testing Strategy

**Two-layer approach:**

1. **Unit tests** - Fast, deterministic pipeline logic validation
2. **E2E tests** - Live integration with Figma API and LLM

## Running Tests

### Unit Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm run test:watch

# Single file
pnpm test test/framework-detection.test.js

# Filter by name
pnpm test -t "validates react component"
```

### E2E Tests

**⚠️ For Agents: Always use pnpm scripts, not jest directly.**

**Chakra UI (React):**
```bash
# Small subset (Button only, ~2 min)
pnpm run test:e2e:chakra:small

# Full suite (~2.5 min)
pnpm run test:e2e:chakra

# Keep artifacts + verbose output
CHAKRA_E2E_KEEP=1 SUPERCONNECT_E2E_VERBOSE=1 pnpm run test:e2e:chakra:small

# Custom components
CHAKRA_E2E_ONLY="Button,Alert,Badge" pnpm run test:e2e:chakra
```

**ZapUI (Angular):**
```bash
# Small subset (Button only, ~2 min)
pnpm run test:e2e:zapui:small

# Full suite (~45 sec)
pnpm run test:e2e:zapui

# Keep artifacts + verbose output
ZAPUI_E2E_KEEP=1 SUPERCONNECT_E2E_VERBOSE=1 pnpm run test:e2e:zapui:small

# Custom components
ZAPUI_E2E_ONLY="Button,Alert" pnpm run test:e2e:zapui
```

**E2E Options:**
- `*_E2E_KEEP=1` - Preserve temp directory (path printed to console)
- `SUPERCONNECT_E2E_VERBOSE=1` - Show all child command output
- `*_E2E_ONLY="Comp1,Comp2"` - Test specific components

## Debugging

### Unit Test Failures

```bash
# Run single test
pnpm test test/failing-test.test.js

# Run by name
pnpm test -t "exact test name"

# Add console.log - Jest shows all output
```

### E2E Test Failures

```bash
# Keep artifacts
CHAKRA_E2E_KEEP=1 pnpm run test:e2e:chakra:small

# Verbose output
SUPERCONNECT_E2E_VERBOSE=1 pnpm run test:e2e:chakra:small
```

**Inspect generated files:**
```
{tempDir}/
├── codeConnect/*.figma.tsx     # Generated Code Connect files
└── superconnect/
    ├── orienter-agent.log      # Orientation LLM calls
    ├── orientation.jsonl       # Orienter decisions
    ├── codegen-summaries/      # Per-component results
    └── codegen-agent-transcripts/  # Full agent I/O
```

## CI Policy

**Every push:**
- Unit tests (`pnpm test`)
- Fast (<10s), deterministic, no secrets

**Main branch (with secrets):**
- Full E2E suites (Chakra + ZapUI, ~3.5 min)
- Validates against live Figma + LLM

## Test Organization

```
test/
├── *-e2e.test.js          # E2E tests (require tokens)
├── direct-codegen.test.js # Combined React/Angular codegen tests
├── angular-*.test.js      # Angular-specific
├── react-*.test.js        # React-specific
├── framework-*.test.js    # Framework detection
└── validate-*.test.js     # Validation layer
```

**Fixtures:**
```
fixtures/
├── react-sample/          # Minimal React test case
├── angular-sample/        # Minimal Angular test case
├── test-patterns/         # Code Connect pattern examples
├── chakra-ui/             # Git submodule (E2E)
└── zapui/                 # Git submodule (E2E)
```

## Reliability

**Unit tests:** 100% deterministic
- No network, time dependencies, or randomness
- Static fixtures only

**E2E tests:** Intentionally non-deterministic
- Validates against live systems
- Expected variability: LLM wording, network latency
- Opt-in (not blocking CI by default)

## Adding Tests

```javascript
// test/my-feature.test.js
const { myFunction } = require('../src/util/my-feature');

describe('myFunction', () => {
  test('handles edge case', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```

Create fixture if needed:
```bash
mkdir -p fixtures/my-feature/{src,superconnect,codeConnect}
# Add minimal repro files
```
