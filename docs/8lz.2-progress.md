# Task 8lz.2 Progress: Replace Pipeline Runner

**Status:** Partial completion  
**Date:** 2025-01-05

## Completed ✅

### 1. Updated Pipeline Runner (scripts/run-pipeline.js)
- ✅ Updated comments: 5-stage → 3-stage pipeline
- ✅ Removed orientation stage execution
- ✅ Updated DEFAULT_MAX_TOKENS: 2048 → 4096 (single default)
- ✅ Removed DEFAULT_ORIENTATION_MAX_TOKENS constant
- ✅ Updated stage labels ("Unified codegen" instead of separate stages)
- ✅ Removed `needOrientation` variable
- ✅ Removed orientation args building
- ✅ Removed call to `run-orienter.js`
- ✅ Updated codegen args to not require `--orienter` flag

**Result:** Pipeline runner now reflects 0.3.x architecture conceptually

## Remaining Work 🚧

### 2. Update run-codegen.js Implementation

**Current State:**
- run-codegen.js (1347 lines) still uses 0.2.x approach
- Reads orientation.jsonl (which won't exist in 0.3.x)
- Uses separate orient → codegen flow per component
- Calls processReactComponent/processAngularComponent from direct-codegen modules

**Required Changes:**
1. Replace 0.2.x component processing loop with calls to `processAllComponents` from unified-codegen
2. Remove dependency on orientation.jsonl
3. Load repo-index.json instead (or keep repo-summary.json for now as stopgap)
4. Build Figma evidence structure expected by unified-codegen
5. Remove references to orientation data
6. Update output path handling for new artifact structure

**Key Function to Use:**
```javascript
const { processAllComponents } = require('../src/agent/unified-codegen');

// Call with:
await processAllComponents({
  agent,            // ClaudeAgentAdapter instance
  repoRoot,         // Target repo path
  indexPath,        // Path to repo-index.json
  components,       // Array of { figmaEvidence, figmaUrl }
  framework,        // 'react' or 'angular'
  maxRetries,       // From config
  maxTokens,        // From config
  logDir,           // superconnect/ directory
  onProgress        // Optional callback for status updates
});
```

### 3. Remove/Archive Orienter Script

**File:** `scripts/run-orienter.js`

**Options:**
1. Delete entirely (breaking change, but clean)
2. Archive to `scripts/archive/run-orienter-0.2.x.js`
3. Keep but add deprecation warning

**Recommendation:** Move to archive directory for reference

### 4. Update Tests

**Affected Tests:**
- Any tests that invoke run-pipeline.js end-to-end
- Tests that expect orientation.jsonl artifact
- Tests that mock orientation data

**Actions:**
- Update fixture expectations
- Remove orientation-related test data
- Add tests for unified codegen artifacts

### 5. Clean Up Legacy Codegen

**Files to Consider:**
- `src/react/direct-codegen.js` (still used by current run-codegen.js)
- `src/angular/direct-codegen.js` (still used by current run-codegen.js)

**Decision Needed:**
- Keep as-is for now (they work, just not wired up)
- Archive to `src/react/direct-codegen-0.2.x.js`
- Delete (aggressive, but clean)

**Recommendation:** Archive for comparison/reference

## Implementation Plan

### Phase 1: Minimal Working Version (Priority)
1. Create simplified run-codegen.js that wraps processAllComponents
2. Load Figma components from figma-components-index.json
3. Load repo index (or use repo-summary.json as adapter)
4. Call processAllComponents with proper structure
5. Handle results and write artifacts
6. Basic error handling

**Estimated Effort:** 2-3 hours  
**Blocks:** E2E testing, fixture validation

### Phase 2: Polish & Cleanup
1. Archive orienter script
2. Archive 0.2.x direct-codegen modules
3. Update any remaining references
4. Clean up unused constants/functions
5. Update CLI help text

**Estimated Effort:** 1 hour  
**Blocks:** Final acceptance

### Phase 3: Testing
1. Run against react-sample fixture
2. Run against angular-sample fixture
3. Verify artifacts match expected structure
4. Verify validation gates pass

**Estimated Effort:** 2 hours (includes debugging)  
**Blocks:** Task completion

## Risks & Blockers

### Known Issues
1. **Repo index not yet built by pipeline** - Currently using repo-summary.json
   - **Mitigation:** Keep using repo-summary until index builder implemented
   - **Impact:** Moderate - limits agent tool effectiveness

2. **Integration spike findings still unaddressed**
   - Agent adds explanatory text
   - Validation too lenient
   - Agent doesn't use queryIndex effectively
   - **Mitigation:** Document as known issues, address in follow-up tasks

3. **Fixture data may be stale**
   - angular-sample/react-sample might not have proper index data
   - **Mitigation:** Regenerate fixtures as part of testing

### Dependencies
- Task depends on: 8lz.1 (spec) ✅ DONE
- Task blocks: 8lz.4, zjb.4, zjb.7

## Next Actions

1. **Immediate:** Simplify run-codegen.js to call processAllComponents
2. **Then:** Test with react-sample fixture
3. **Then:** Test with angular-sample fixture
4. **Then:** Address any bugs found
5. **Finally:** Archive legacy code and close task

## Files Modified

- ✅ `scripts/run-pipeline.js` - Updated for 0.3.x
- 🚧 `scripts/run-codegen.js` - Needs rewrite
- ⏳ `scripts/run-orienter.js` - Needs archiving

## Testing Status

- ✅ Unit tests: 133 passing (no regressions)
- ⏳ E2E react-sample: Not yet tested
- ⏳ E2E angular-sample: Not yet tested

## Decision Log

1. **Keep repo-summary.json for now** instead of immediately requiring repo-index.json
   - Rationale: Index builder not yet implemented (separate task)
   - Impact: Agent tools less effective, but pipeline functional

2. **Use processAllComponents from unified-codegen** instead of rewriting
   - Rationale: Already tested, well-structured
   - Impact: Simpler implementation, less risk

3. **Archive instead of delete** 0.2.x code
   - Rationale: Useful for comparison, rollback if needed
   - Impact: Slightly more clutter, but safer

✠
