# Testing

## Available Tests

**Unit tests** - Fast validation of core logic (~4s, no API keys needed)
- Framework detection, validation, parsing
- Agent adapters and codegen logic
- React/Angular-specific behavior

**E2E tests** - Full pipeline against real design systems (requires API keys)
- Chakra UI (React) - Full: ~2 min, Small: ~30-45 sec
- ZapUI (Angular) - Full: ~2 min, Small: ~30-45 sec

## Prerequisites

**Unit tests:** Node.js ≥ 22 + `pnpm install`

**E2E tests:**
- `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY` in `.env`
- Git submodules: `git submodule update --init fixtures/chakra-ui fixtures/zapui`

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

**Chakra UI (React):**
```bash
# Pattern regression test (Button, Alert, Input, Dialog, Popover)
pnpm run test:e2e:chakra:small

# Full suite (all components, includes pattern tests)
pnpm run test:e2e:chakra

# Custom components
CHAKRA_E2E_ONLY="Button,Alert,Badge" pnpm run test:e2e:chakra
```

**ZapUI (Angular):**
```bash
# Pattern regression test (Button, Alert, Dialog, FormField)
pnpm run test:e2e:zapui:small

# Full suite (all components, includes pattern tests)
pnpm run test:e2e:zapui

# Custom components
ZAPUI_E2E_ONLY="Button,Alert" pnpm run test:e2e:zapui
```

**E2E Options:**
- `*_E2E_KEEP=1` - Preserve temp directory
- `SUPERCONNECT_E2E_VERBOSE=1` - Show all command output
- `*_E2E_ONLY="Comp1,Comp2"` - Test specific components

## Debugging Failed E2E Tests

```bash
# Keep artifacts and show verbose output
CHAKRA_E2E_KEEP=1 SUPERCONNECT_E2E_VERBOSE=1 pnpm run test:e2e:chakra:small
```

Generated files in temp directory:
```
{tempDir}/
├── codeConnect/*.figma.tsx
└── superconnect/
    ├── orienter-agent.log
    ├── orientation.jsonl
    ├── codegen-summaries/
    └── codegen-agent-transcripts/
```
