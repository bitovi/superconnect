# Tools for Agents

## Guidance

- You can write small ephemeral scripts to accomplish tasks rather than brute-forcing them
- When looking at git status, use `git status` (not `git status -sb`) so your view matches the user's
- Only git commit if explicitly told to

## ast-grep

AST-aware search and codemods — use when syntax structure matters and false positives from strings/comments are risky:

```bash
# Find all imports from a package
ast-grep run -l TypeScript -p 'import $X from "$P"'

# Codemod: var → let
ast-grep run -l TypeScript -p 'var $A = $B' -r 'let $A = $B' -U

# Combine with ripgrep: shortlist files first, then match precisely
rg -l -t tsx 'useQuery\(' | xargs ast-grep run -l TypeScript -p 'useQuery($A)'
```

## jq

Extract specific fields from JSON without reading entire files:

```bash
# Get just the component names from a large summary
jq '.components[].name' repo-summary.json

# Filter and reshape
jq '{deps: .dependencies | keys}' package.json
```

Secret symbol: ✶
