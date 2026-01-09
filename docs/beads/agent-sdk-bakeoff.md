# Bead: Agent SDK vs Direct Prompting Bakeoff

**Goal:** Determine if `api=anthropic-agents` (agent SDK with exploration tools) produces better Code Connect than `api=anthropic` (direct prompting), and whether the cost/latency tradeoff is acceptable

**Status:** Not started

## Pre-flight Checklist
- [ ] Confirm Chakra E2E small tests pass with current config (direct mode)
- [ ] Identify 3-5 components with proven semantic test coverage
- [ ] Verify token logging is captured in agent transcripts

## Test Protocol

### Step 1: Baseline (direct mode)
```bash
time RUN_CHAKRA_E2E=1 CHAKRA_E2E_ONLY=Button,Alert,Input pnpm test:e2e:chakra:small
```
- Record: pass/fail, wall time
- Must PASS before proceeding

### Step 2: Configure agent SDK mode
Edit `fixtures/chakra-ui/superconnect.toml`:
```toml
[agent]
api = "anthropic-agents"
```

### Step 3: Run agent SDK mode
```bash
time RUN_CHAKRA_E2E=1 CHAKRA_E2E_ONLY=Button,Alert,Input pnpm test:e2e:chakra:small
```
- Record: pass/fail, wall time

### Step 4: Restore config
```bash
git checkout fixtures/chakra-ui/superconnect.toml
```

### Step 5: Collect token usage
- Read agent transcripts from temp directories
- Sum input/output tokens for each mode

## Metrics to Compare

| Metric | Direct Mode | Agent SDK |
|--------|-------------|-----------|
| Pass/Fail | | |
| Wall time (s) | | |
| Input tokens | | |
| Output tokens | | |
| Total cost ($) | | |

## Decision Criteria
- **Make default if:** Quality equal or better AND cost < 2x
- **Keep opt-in if:** Quality marginally better but cost > 2x, OR introduces flakiness

## Scope Constraints
- Chakra only (ZapUI has component name mismatches to fix separately)
- Proven components only (Button, Alert, Input - not newly added ones)
- No parallel execution
- No elaborate scripts
