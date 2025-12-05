# Coding Philosophy for Superconnect

This document guides contributors and coding agents working in this repo. It complements `AGENTS.md` and focuses on how to evolve the code and pipeline safely.

## High‑level principles

- **Lightly functional style**
  - Prefer small, side‑effect‑free functions that are pure functions of their inputs.
  - When side effects are required (I/O, network, process exit), isolate them at the edges and call into pure helpers.
  - Pass dependencies (paths, env, config) explicitly rather than reading globals deep inside helpers.

- **Pipeline over cleverness**
  - Keep each stage of the pipeline focused on a single responsibility.
  - Favor predictable data transformations between stages over “smart” but opaque logic.
  - Make cross‑stage contracts explicit via JSON shapes and documented file formats.

- **Grounded in real artifacts**
  - All mapping decisions must be grounded in:
    - Figma component metadata produced by `figma-scan.js`.
    - Repo summaries from `summarize-repo.js`.
    - Orientation records from `run-orienter.js`.
  - Avoid heuristics that require capabilities outside those inputs unless we extend the data model explicitly.

## Implementation preferences

- **Structure and style**
  - Use Node.js CommonJS modules (`require`, `module.exports`) consistently with existing code.
  - Prefer small modules with a few exported functions over large, monolithic files.
  - Keep CLI entrypoints (`scripts/*.js`) as thin orchestration layers that delegate to helpers.
  - Avoid introducing frameworks or build steps; keep things runnable with plain Node ≥ 18.

- **Functions and data**
  - Encode configuration in data structures (objects, arrays, JSON) where possible instead of deeply nested conditionals.
  - When adding new CLI flags or config fields, document how they flow through:
    - Argument parsing.
    - Config normalization.
    - Downstream stages.
  - Avoid hidden coupling; if one stage depends on another’s output, express that through file paths and JSON contracts.

- **Logging and error handling**
  - Maintain the existing pattern of:
    - Clear console output for high‑level progress and errors.
    - Structured logs on disk for agent input/output and per‑component results.
  - Fail fast on misconfiguration (missing tokens, invalid paths) before running heavy stages.
  - Prefer explicit exit codes and clear error messages over silent failures.

- **Tests**
  - Jest is available via `npm test`; keep tests focused and fast.
  - When adding behavior that is not purely I/O, consider unit tests for core helpers (e.g., parsing, normalization, matching).
  - Do not add heavy integration tests that rely on live Figma or LLM APIs; mock or fixture inputs instead.

## Agent‑specific guidance

- **Prompts as contracts**
  - Treat prompt files in `prompts/` as part of the public contract between stages.
  - When changing a prompt in a way that affects outputs (e.g., fields, shapes), also update:
    - The corresponding consumer code.
    - The data model documentation in `docs/DATA-MODEL.md`.

- **Adapters, not inline SDK usage**
  - All LLM interactions should go through `OpenAIAgentAdapter` or `ClaudeAgentAdapter`.
  - Do not instantiate SDK clients ad hoc in other files; extend adapters if behavior must change.

- **Determinism where possible**
  - While LLMs are probabilistic, the surrounding code should be deterministic:
    - Sort lists before serializing when order does not matter.
    - Use stable keys and names for generated files.
  - This makes reruns easier to reason about and diffs smaller.


