# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.10] - 2025-12-18

### Fixed
- **Windows PowerShell output visibility**: Child process output (Figma scan details, code generation progress) now displays correctly on Windows
  - Root cause: `spawnSync` with `shell: true` spawned cmd.exe as intermediary, which interfered with console output and ANSI color codes
  - Solution: Call Node.js scripts directly via `process.execPath` with argument arrays instead of shell command strings
  - Eliminates shell quoting/escaping issues and works identically across all platforms

## [0.2.9] - 2025-12-18

### Changed
- Refactor validation layer to use hybrid AST/regex approach
  - Replace regex-based `figma.*()` extraction with ts-morph AST traversal for better edge case handling
  - Keep proven regex patterns for template/JSX validation
  - Improves correctness (+43%) and maintainability (+33%) with minimal performance impact

## [0.2.8] - 2025-12-17

### Performance
- Replace npx with direct CLI invocation for Figma validation (4x faster on Windows)
  - Resolve @figma/code-connect binary path directly from node_modules
  - Use process.execPath (node) to invoke CLI instead of npx
  - Eliminates ~30s npx overhead per CLI call on Windows
  - Windows CI improved from 64s to 16s for unit tests
  - Reduce timeout from 120s to 30s (no package download overhead)

### Changed
- Trigger CI unit tests on version tags in addition to branch pushes
- Improve release process documentation with pre-flight checks and error summaries
- Remove global Figma CLI pre-install from CI workflow (no longer needed)

## [0.2.7] - 2025-12-17

### Fixed
- **CRITICAL:** Windows compatibility for validation - add `shell: true` to all npx spawn calls
  - v0.2.6 used `npx.cmd` but still failed with EINVAL on Windows
  - Now uses `shell: true` which is the Node.js recommended approach for cross-platform compatibility
  - Removes platform-specific npx.cmd detection in favor of simpler, more robust solution

## [0.2.6] - 2025-12-17

### Fixed
- **CRITICAL:** Windows npx compatibility - use npx.cmd on Windows to prevent ENOENT errors
  - Previously caused 100% validation failure on Windows with "spawnSync npx ENOENT"
  - Affects all Code Connect file validation attempts
  - Now correctly detects Windows platform and uses npx.cmd

### Changed
- Streamline agent documentation for clarity and reduced token usage

## [0.2.5] - 2025-12-17

### Fixed
- **CRITICAL:** Move @figma/code-connect from devDependencies to dependencies
  - Previously, global npm installs (`npm install -g @bitovi/superconnect`) did not include the Figma CLI
  - This caused 100% validation failure on all Code Connect files with "unknown error"
  - Now the CLI is always installed with superconnect
- Add upfront check for Figma CLI availability with clear troubleshooting steps
- Improve validation error messages to show exit code, stdout, and stderr for debugging
- Fix Anthropic SDK 0.71.2 compatibility:
  - Add explicit `stream: false` for non-streaming requests
  - Increase timeout to 20 minutes for long-running orientation tasks (SDK default was 10 minutes)

### Changed
- Update dependencies to latest compatible versions:
  - @anthropic-ai/sdk: 0.18.0 → 0.71.2
  - commander: 12.1.0 → 14.0.2
  - openai: 4.104.0 → 6.14.0
  - undici: 6.18.1 → 7.16.0
  - @figma/code-connect: 1.3.12 (already current)
- Keep chalk at 4.1.2 and p-limit at 3.1.0 (newer versions are ESM-only, incompatible with CommonJS)

## [0.2.4] - 2025-12-17

### Fixed
- Add helpful error messages when API returns "Invalid model name" errors (400 status)
  - Shows current model being used
  - Suggests common alternatives (gpt-4o, claude-sonnet-4-5, etc.)
  - Explains how to set model via superconnect.toml or CLI flag
  - Links to model documentation
- Warn users when using custom `base_url` without explicitly setting a `model`
  - Prevents confusion when default model doesn't exist on custom endpoints
  - Applies to LiteLLM, Azure OpenAI, vLLM, and other OpenAI-compatible proxies

## [0.2.3] - 2025-12-17

### Fixed
- **Windows compatibility**: Use Node's native fetch instead of undici to fix "fetch failed" errors on Windows PowerShell with corporate networks
- Include CHANGELOG.md in npm package files array so users can see release notes
- Change CI workflow to use `npm ci` instead of `npm install` for consistency with publish workflow
- Add .npmrc with engine-strict=true to enforce Node >=22 requirement (was only advisory before)
- Remove redundant .npmignore file (files[] array in package.json already controls what's published)

## [0.2.2] - 2025-12-17

### Fixed
- Include .version-sha in npm package files array (was being generated but not included in published package)

## [0.2.1] - 2025-12-17

### Added
- Include git SHA in npm package version output via prepublishOnly script
- E2E tests now run in parallel using GitHub Actions matrix strategy

### Fixed
- Read api_key from superconnect.toml when validating agent token (interactive setup bug where custom API keys were written to TOML but not read during validation)

## [0.2.0] - 2025-12-17

### Changed
- **BREAKING:** Rename `[agent]` config keys for semantic clarity:
  - `backend` → `api` (values: `"anthropic"` or `"openai"`)
  - `sdk_model` → `model`
  - Value `"claude"` → `"anthropic"` (reflects API format, not model)
- **BREAKING:** Rename CLI flags: `--agent-backend` → `--agent-api`
- Old config keys still work with deprecation warnings; update recommended
- Make superconnect.toml self-documenting with clearer comments and actionable guidance
- Replace all gpt-4 references with gpt-5.1-codex-mini (only gpt-5 class models in examples)

### Added
- LiteLLM and OpenAI-compatible endpoint support for agent APIs
- New `base_url` and `api_key` fields in `[agent]` section of superconnect.toml for custom endpoints
- Support for OPENAI_BASE_URL environment variable
- CLI flags `--agent-base-url` and `--agent-api-key` for run-orienter.js and run-codegen.js
- `--version` flag to display version number with git SHA (e.g., "0.2.0 (abc1234)")
- Interactive prompting for custom endpoint configuration (base_url/api_key) when choosing OpenAI API on first run
- All configuration options now visible in generated superconnect.toml with helpful comments
- Deprecation warnings when old config keys (`backend`, `sdk_model`) are detected
- Comprehensive unit tests for custom endpoint support
- Documentation for using LiteLLM, Azure OpenAI, vLLM, and other OpenAI-compatible servers

### Fixed
- Enhance error diagnostics for network and certificate issues in corporate environments across all pipeline stages
- Add detailed error logging to agent adapters (error type, code, status, cause) to help diagnose connection failures
- Improve error messages for TLS/SSL certificate errors with specific troubleshooting steps for locked-down networks
- Add network error detection and corporate environment guidance to Figma scan stage
- Add enhanced authentication and file-not-found error messages to Figma API requests
- Preserve network error details in React/Angular codegen (no longer wrapped as generic "Agent error")
- Flag network vs agent errors in codegen attempt logs for better diagnostics
- Always display log file locations when stages fail so users can access complete diagnostic information
- Point users to docs/NETWORK-TROUBLESHOOTING.md for detailed corporate network help

## [0.1.10] - 2025-12-16

### Changed
- Improve README comparison with Figma Code Connect, clarifying that Superconnect works fully automatically and supports Angular/HTML (which Figma's interactive setup does not)

## [0.1.9] - 2025-12-16

### Fixed
- Add `scope: '@bitovi'` parameter to setup-node in publish workflow for proper scoped package authentication

## [0.1.7] - 2025-12-15

### Fixed
- Remove `prepublishOnly` hook that caused npm publish to run tests twice, leading to intermittent publish failures

## [0.1.6] - 2025-12-15

### Fixed
- Fix duplicate logDir property in test file causing intermittent test failures

## [0.1.5] - 2025-12-15

### Changed
- Upgrade project to require Node.js ≥ 22.0.0 (previously ≥ 20.0.0)
- Update CI/CD workflows to use Node 22 consistently
- Update documentation (README.md, TESTING.md) to reflect Node 22 requirement

## [0.1.4] - 2025-12-15

### Fixed
- Fix test failures in CI by adding missing logDir parameter to processComponent calls
- Suppress Anthropic SDK --localstorage-file warnings in tests with NODE_NO_WARNINGS=1

## [0.1.3] - 2025-12-15

### Fixed
- Fix DEP0190 Node.js deprecation warning by removing `shell:true` from spawnSync calls with args arrays
- Fix boolean variant validation to recognize True/False, Yes/No, On/Off patterns as valid for `figma.boolean()`
- Strengthen prompt guidance prohibiting `&&`, `||`, and ternary operators in example JSX/templates to prevent Code Connect validation errors

### Changed
- Enhance retry prompts with explicit CRITICAL section directing agent to use only properties from Figma Component Data
- Add comprehensive agent I/O transcript logging for debugging (system/user prompts, outputs, token usage)
- Rename output directories for clarity: `codegen-logs` → `codegen-summaries`, `mapping-agent-logs` → `codegen-agent-transcripts`

## [0.1.1] - 2025-12-15

### Changed
- Update repository URLs to github.com/bitovi/superconnect
- Set up automated release workflow with GitHub Actions
- Add RELEASE.md documenting the release process
- Update documentation for npm granular access tokens

## [0.1.0] - 2025-12-15

### Added
- Initial release of @bitovi/superconnect
- AI-powered code generation for Figma Code Connect mappings
- Support for React and Angular frameworks
- Five-stage pipeline: repo summarizer, Figma scan, orienter, codegen, finalizer
- Claude (Anthropic) and OpenAI backend support
- Direct codegen with built-in validation and retry logic
- Graceful interrupt handling and partial runs
- Comprehensive test suite with E2E validation against Chakra UI and ZapUI

### Features
- Automatic framework detection (React/Angular)
- Component-level filtering with `--only` and `--exclude` flags
- Concurrent codegen with configurable parallelism
- Cached system prompts for efficient LLM usage
- Detailed logging and colorized console output
- figma.config.json generation for Code Connect CLI
- Support for monorepo path aliases
- Document URL substitutions for Figma node links

[0.1.4]: https://github.com/bitovi/superconnect/releases/tag/v0.1.4
[0.1.3]: https://github.com/bitovi/superconnect/releases/tag/v0.1.3
[0.1.1]: https://github.com/bitovi/superconnect/releases/tag/v0.1.1
[0.1.0]: https://github.com/bitovi/superconnect/releases/tag/v0.1.0
