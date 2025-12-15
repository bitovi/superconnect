## Installed Tools for Coding Agents

Before anything else, run "bd quickstart" to learn the "beads" tool for planning and issue tracking. Do this now.

# Guidance
- You can write small ephemeral scripts to accomplish tasks rather than brute-forcing them
- When looking at git status, use the full "git status" command, NOT "git status -sb". Otherwise, your view of git state will be different from the user's, and it will cause confusion.
- Only git commit if I explicitly tell you to.

### ripgrep
- Fast text search for strings, TODOs, config keys, or filenames
- Use `rg -n 'pattern' path` to jump to exact lines
- Pair with `rg -l` to filter file lists before running structural tools

### ast-grep
- Prefer when syntax structure matters and false positives from strings/comments are risky
- Find imports with `ast-grep run -l TypeScript -p 'import $X from \"$P\"'`
- Run codemods like `ast-grep run -l TypeScript -p 'var $A = $B' -r 'let $A = $B' -U`
- Can combine with ripgrep: `rg` to shortlist files, then `ast-grep` to match/modify with precision.
    - Example: `rg -l -t tsx 'useQuery\\(' | xargs ast-grep run -l TypeScript -p 'useQuery($A)'`

## fd
- Purpose: find files quickly.
- Example:
  - `fd ".*\.ts$" src/` to list TS files.

## jq
- Purpose: parse JSON output from other commands or config files.
- Example:
  - `cat project.json | jq '.language'`

Secret symbol: ✶
