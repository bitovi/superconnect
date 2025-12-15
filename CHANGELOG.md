# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/bitovi/superconnect/releases/tag/v0.1.0
