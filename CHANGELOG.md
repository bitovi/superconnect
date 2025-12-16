# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.3]: https://github.com/bitovi/superconnect/releases/tag/v0.1.3
[0.1.1]: https://github.com/bitovi/superconnect/releases/tag/v0.1.1
[0.1.0]: https://github.com/bitovi/superconnect/releases/tag/v0.1.0
