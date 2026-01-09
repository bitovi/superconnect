# Testing

## Quick Reference

```bash
pnpm test                                       # Unit tests (~4s)
pnpm test:e2e chakra                            # All Chakra E2E (~30s/component)
pnpm test:e2e chakra Button                     # Single component
pnpm test:e2e chakra Button Alert Input         # Multiple components
pnpm test:e2e zapui --keep                      # Keep temp artifacts
pnpm test:e2e zapui --agent-sdk                 # Use Agent SDK instead of Messages API
pnpm test:e2e zapui --model claude-sonnet-4-5   # Use specific model
pnpm test:e2e --help                            # Show options
```

## Prerequisites

**Unit tests:** Node.js ≥ 22 + `pnpm install`

**E2E tests:**
- `FIGMA_ACCESS_TOKEN` and `ANTHROPIC_API_KEY` in `.env`
- Git submodules: `git submodule update --init fixtures/chakra-ui fixtures/zapui`

## CI

- **Unit tests** - Every push
- **E2E tests** - Version tags only (see [e2e.yml](../.github/workflows/e2e.yml))

## Semantic Assertions

E2E tests validate that LLM-generated Code Connect has correct Figma→code prop mappings.
Assertions are defined in `SEMANTIC_ASSERTIONS` in [scripts/test-e2e.js](../scripts/test-e2e.js).

## For Agents: Handling Long-Running Tests

| Command | Duration | Run in background? |
|---------|----------|---------------------|
| `pnpm test` | ~4s | No |
| `pnpm test:e2e chakra Button` | ~45s | Yes |
| `pnpm test:e2e chakra` (all) | ~5min | Yes |

**E2E tests take 30-60 seconds per component.** To avoid terminal sprawl and interrupted tests:

1. Run E2E tests as a background process, then poll for completion
2. Never spawn a second test terminal while one is running
3. Don't interrupt a running E2E test—wait for it to finish
4. Unit tests are fast enough to run in foreground
