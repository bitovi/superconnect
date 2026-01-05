# Integration Spike Findings: Single Component Through Agentic Flow

**Date:** 2025-01-02  
**Component Tested:** FixtureComponent (react-sample fixture)  
**Status:** ✅ Partially successful - flow completes but reveals issues

## Executive Summary

Successfully ran a single React component through the unified agentic pipeline from end to end. The agent made tool calls, generated code, and validation passed. However, the spike revealed critical issues that need addressing before the pipeline is production-ready.

## Test Setup

- **Component:** `FixtureComponent` from `fixtures/react-sample`
- **Figma Data:** Mock component with `label`, `disabled`, `variant` properties
- **Repo Index:** 1 file indexed (`src/App.tsx`), 0 exports
- **Agent Model:** claude-sonnet-4-20250514
- **Max Retries:** 2
- **Max Tokens:** 4096 (default)

## What Worked ✅

1. **End-to-End Flow:** The pipeline successfully completed from Figma input to validated code output
2. **Tool Integration:** Agent made 4 tool calls (specific tools unknown from output)
3. **First Attempt Success:** Validation passed on attempt 1, no retries needed
4. **Code Structure:** Generated valid TypeScript/React Code Connect structure
5. **Metrics Collection:** Tool metrics properly tracked (filesRead: 0, queries: 0, listCalls: 0)

## Issues Discovered ❌

### 1. Agent Not Following "Raw Code Only" Instruction

**Severity:** HIGH  
**Impact:** Output requires post-processing or manual cleanup

The agent generated explanatory text before the actual code:

```
Since I cannot access the repository files to find the actual FixtureComponent 
implementation, I'll generate a Code Connect file based on the Figma component 
data provided...

Based on the Figma component data, here's the Code Connect file:

```tsx
import figma from '@figma/code-connect'
...
```
```

**Expected:** Raw code starting with `import` statement  
**Actual:** Explanatory paragraph + code block

**Root Cause:** Prompt says "Output ONLY the raw `.figma.tsx` code" but the agent is defaulting to helpful explanation mode.

**Recommended Fix:**
- Strengthen prompt with explicit instruction: "Do not include ANY explanatory text, markdown fences, or commentary. Your response must be ONLY the raw TypeScript code that can be written directly to a .figma.tsx file."
- Add example of exact expected format
- Consider prompt caching to ensure consistency

### 2. Validation Too Lenient

**Severity:** HIGH  
**Impact:** Invalid code passes validation

The validation marked the code as valid even though it contains:
- Explanatory prose
- Markdown code fences
- Text that would cause syntax errors if written to .figma.tsx

**Current Behavior:** `valid: true` for code with prose wrapper  
**Expected:** `valid: false` with error "Code contains non-code content"

**Recommended Fix:**
- Add pre-validation check: code must start with `import` or `export`
- Reject any code containing markdown fences when extracted
- Add heuristic: if code contains sentences (capital letter + period + space), likely explanation not code

### 3. Agent Not Using Repo Index Effectively

**Severity:** MEDIUM  
**Impact:** Agent makes assumptions instead of querying available data

The agent said: "Since I cannot access the repository files..."

But the test setup included:
- A repo index with 1 file (`src/App.tsx`)
- queryIndex tool available
- readFile tool available

**Metrics show:** 0 queries, 0 files read, 0 list calls

**Why This Happened:**
- The repo index had 0 exports (exports field was empty)
- The prompt may not emphasize queryIndex strongly enough
- Agent may have received an error from queryIndex and not shown it in output

**Recommended Fix:**
- Ensure repo index includes proper export data for fixtures
- Add explicit instruction: "You MUST call queryIndex first before making assumptions"
- Consider adding a "planning" tool that shows what the agent is thinking
- Investigate why exports field was empty in react-sample index

### 4. Missing Export Data in Repo Index

**Severity:** MEDIUM  
**Impact:** Limits agent's ability to find components

The react-sample repo index showed:
```json
{
  "files": 1,
  "exports": 0
}
```

**Expected:** Should have detected exports from `src/App.tsx`

**This Affects:**
- queryIndex by export name (the primary use case)
- Agent's ability to locate components without filesystem exploration

**Recommended Fix:**
- Verify index building correctly extracts exports
- Add test ensuring fixtures have realistic export data
- Document what's expected in index schema

## Code Quality Assessment

Despite the wrapper text, the generated code itself was reasonable:

```tsx
import figma from '@figma/code-connect'
import { FixtureComponent } from './FixtureComponent'

export default figma.connect(FixtureComponent, 'https://figma.com/file/dummy-react?node-id=react-1', {
  props: {
    variant: figma.enum('variant', { primary: 'primary', secondary: 'secondary' }),
    label: figma.string('label'),
    disabled: figma.boolean('disabled')
  },
  example: ({ variant, label, disabled }) => (
    <FixtureComponent variant={variant} disabled={disabled}>
      {label}
    </FixtureComponent>
  )
})
```

**Good:**
- Correct import syntax
- Proper figma.connect structure
- Used figma.enum for variants
- Used figma.string and figma.boolean appropriately
- Props destructured correctly in example

**Issues:**
- Import path `./FixtureComponent` is assumed, not verified
- Should have been `./App` based on orientation data
- Import should be specific export name from actual file

## Performance Metrics

- **Total Attempts:** 1
- **Validation Passed:** true (incorrectly)
- **Tool Calls Made:** 4 (types unknown)
- **Files Read:** 0
- **Index Queries:** 0
- **List Operations:** 0

**Performance Assessment:** Fast (single attempt) but ineffective (no exploration)

## Blocking Issues for Production

Before using this pipeline in production, must address:

1. **[BLOCKER]** Prompt must be revised to eliminate explanatory text
2. **[BLOCKER]** Validation must reject non-code output
3. **[HIGH]** Repo index must include export data
4. **[HIGH]** Agent must be encouraged to actually use tools

## Recommendations for 8lz.1 (Pipeline Spec)

Based on this spike, the pipeline spec should include:

1. **Pre-validation Check:** Before calling Figma CLI validation, check:
   - Code starts with `import` or `export`
   - Code doesn't contain markdown fences
   - Code doesn't contain prose (simple heuristic: sentences with periods)

2. **Prompt Refinement Strategy:**
   - Test prompt variations in isolation
   - Measure rate of "code-only" responses
   - Consider system-level instruction vs user message placement
   - Document which Claude model versions follow instructions best

3. **Tool Usage Requirements:**
   - Define success criteria: "agent must call queryIndex at least once"
   - Consider making queryIndex a required first call
   - Log tool call reasoning to understand agent's decision-making

4. **Fixture Quality Standards:**
   - All test fixtures must have realistic repo indexes with exports
   - Document what constitutes a "good" fixture for testing
   - Add fixture validation script

5. **Observability:**
   - Log all tool calls with parameters and results
   - Capture agent's reasoning (if available from Claude API)
   - Track metrics per component for performance analysis

## Next Steps

1. ✅ Document findings (this file)
2. [ ] Fix DEFAULT_MAX_TOKENS parameter passing (if needed in other places)
3. [ ] Enhance validation to reject explanatory text
4. [ ] Strengthen prompts to enforce code-only output
5. [ ] Fix react-sample fixture repo index to include exports
6. [ ] Run spike again to verify fixes
7. [ ] Test with angular-sample fixture
8. [ ] Use learnings to write detailed 8lz.1 spec

## Files Modified During Spike

- `scripts/integration-spike.js` (NEW) - Spike test script
- `src/agent/unified-codegen.js` - Added default values for maxRetries, maxTokens
- `fixtures/react-sample/superconnect/spike-output.figma.tsx` (NEW) - Generated output

## Conclusion

The integration spike successfully demonstrated the end-to-end flow and surfaced critical issues before full implementation. The architecture is sound, but prompt engineering and validation need refinement. The findings provide concrete direction for the 8lz.1 pipeline spec.

**Verdict:** Ready to proceed with spec writing, with clear priorities for what needs to be addressed.
