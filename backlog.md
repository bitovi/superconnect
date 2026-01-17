
# Backlog

This file tracks work planned, in progress, and completed. For task details and dependencies, see `ergo list` or individual task IDs.

## ✓ Completed

### First-run UX improvements (Epic: TMUFKE)
- Separated `superconnect init` from `superconnect` run command
- Smart API key detection and auto-selection of provider
- Clear CLI prompt wording and bracket syntax explanation
- Improved config file naming and error messages

### Config improvements
- Renamed `anthropic-agents` → `anthropic-agent-sdk` / `anthropic-messages-api` / `openai-chat-api` (ZSKOYZ)
- Renamed `base_url` → `llm_proxy_url` (XX4R7E)
- Renamed `figma_url` → `figma_file_url` (BWZGPP)
- Renamed `output_dir` → `code_connect_output_dir` (G7VNMV)

### Documentation & install
- README: Added npm install option alongside pnpm (T2HLUY)
- Fixed npx caching issues - use @latest in docs (4DCJJU)

### Codegen
- Default Code Connect files adjacent to components (colocation) (PFBY5W)

### TypeScript port progress (Epic: LZMTQC)
- Added TypeScript tooling with Node native execution (ZRBVCF)
- Converted utility modules to TypeScript (E3NHKM)
- Converted pipeline scripts to TypeScript (P7WPXA - in progress)

## ◐ In Progress

### TypeScript port (Epic: LZMTQC)
- Pipeline scripts conversion (P7WPXA) - claimed by copilot
  - ✓ figma-scan.ts
  - ✓ finalize.ts
  - ✓ run-codegen.ts
  - ✓ run-orienter.ts
  - ✓ run-pipeline.ts
  - ✓ summarize-repo.ts

### Monorepo support (Epic: LGOXXL)
- Detect monorepo structure in summarizer (TIVEEP) - claimed by brandonharvey

## ○ Planned / Ready

### TypeScript port (Epic: LZMTQC)
- Convert codegen modules to TypeScript (Y2E5G2)
- Convert tests to TypeScript and enable strict mode (BXG2MM) - blocked by P7WPXA

### Monorepo support (Epic: LGOXXL)
- Single-repo backward compatibility (EGG6IX)
- Add target_package and import_from config (4MHBXI) - blocked
- Init wizard: package picker for monorepos (C4T6PI) - blocked
- Scope repo scanning to target package (PFXEIW) - blocked
- Pass import_from to codegen for imports (NPIXEJ) - blocked

### First-run UX (Epic: VPH4UZ / 3WSUE7)
- Add animated gifs to README for API key setup (QC6I5X)
  - Figma token acquisition
  - Anthropic token acquisition
  - "Publish" step in Figma

### Individual improvements
- Improve CLI prompt wording for clarity (2JH2GU)
- Explain bracket syntax in prompts (A4HYFU)

## 💡 Future Ideas / Considerations

### Scoped codegen
- Allow users to scope codegen to specific components/folders
- Maybe pick a specific package.json in monorepos
- Pick folders where components are located
- Evaluate if TUI is needed for component selection

### Error handling
- Better error messaging when orienter fails due to scope being too narrow
- Should we require running from a directory with package.json?

### Monorepo/nested repo patterns
- Handle deeply nested design systems (design system inside app repo)
- Fix path resolution for non-published design systems used inline
- Detect and adapt to different import patterns (npm vs monorepo inline)
- Agent could ask: "How are components being imported?" and validate patterns with user

---

**Note**: This reflects the state as of the TypeScript port. See `ergo list --epics` for full hierarchy and task statuses.

---

## Appendix: Original Meeting Notes

<details>
<summary>Click to expand original meeting notes (archived)</summary>

- superconnect feedback
	- [ ] port project to typescript
	- justin wants to be able to scope codegen to specific components in the repo (provide a folder)
		- maybe pick a package.json
		- pick folders where the components are
		- do we need a TUI?
	- improve cli copy to help people out
		- explain both keys needed
		- [ ] "no superconnect.toml" sounds like an error
		- explain "component repo path" better
		- [ ] if it finds only one AI API key, make that the default
		- better explain the that thing in brackets is the default
	- add images to readme to help people out
		- "publish" step in figma
		- figma token
		- anthropic token
	- [x] cover the npm and npx install use cases
	- [x]  investigate why npx isn't picking up the latest
	- [x]  "anthropic-agents" isn't a good key, switch to
		- anthropic-agent-sdk
		- anthropic-messages-api
		- openai-***
	- [x] "base-url" isn't a great key
	- error case when justin scoped it too tightly and the orienter failed.
		- should it push back and insist on being where a package.json is?
	- [ ] instead of codeConnect directory, put the generated things next to their component. follow bitovi "modlet" pattern
	- deeply nested in the repo case -- design system is inside the repo itself.
		- messed up paths...
		- carton case design system is NOT being published -- it's being used inline, within the application repo. in shad it doesn't npm install the components, it's a monorepo together with the components.
		- agent should ask "how are the components being imported and used". then ask the user "is this the pattern for how things are being imported?". 

</details>

{◎ ✠}

