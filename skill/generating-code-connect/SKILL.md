---
name: generating-code-connect
description: Generates Figma Code Connect mappings for React or Angular repos, validates them with pre-checks and the Figma CLI, and can publish via figma connect. Use when a user provides a Figma file URL and a component repo and asks for Code Connect files, figma.config.json, or validation.
---

# Generating Code Connect

## Scope
Create Code Connect files, write figma.config.json, validate mappings, and optionally publish

## Command line first
- Prefer `rg`, `jq`, and `ast-grep` over manual inspection
- Use CLI tools or tiny scripts to validate and inspect outputs before editing by hand
- When extracting or transforming JSON, use `jq` instead of ad-hoc parsing

## Inputs to collect
- Repo path, default current working directory
- Figma file URL
- Framework, auto-detect or ask React vs Angular
- Component scope, comma-separated list or Enter for all
- Output directory, default codeConnect
- Permission to install @figma/code-connect locally if missing

## Default behaviors
- Generate all components when the user hits Enter on scope
- Prefer local @figma/code-connect over global installs
- Do not overwrite existing Code Connect files unless the user agrees

## Workflow
0) Pre-flight checks
- Parse the file key from the Figma URL
- Validate the token against the target file without printing it:
  - `curl -s -o /dev/null -w "%{http_code}\n" -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" https://api.figma.com/v1/files/<fileKey>`
- Check for @figma/code-connect with `scripts/check_figma_cli.sh`
- If the token check returns 403 but the user says it is valid:
  - Locate the token source without printing it: `rg -l -g '.env*' -g 'superconnect.toml' "FIGMA_ACCESS_TOKEN|figma_access_token"`
  - Ask the user to set the token in the current shell and re-run the check
  - Confirm the token is non-empty without printing it: `echo ${#FIGMA_ACCESS_TOKEN}`
  - Do not echo or paste the token value in any command or response

1) Detect framework
- Read package.json and look for react or @angular/core
- If ambiguous, ask the user to choose

2) Get Figma data
- Prefer an MCP server if available and use fully qualified tool names ServerName:tool_name
- Otherwise use the Figma REST API with FIGMA_ACCESS_TOKEN
- Follow references/figma-extraction-spec.md for extraction and file naming
- Extract evidence for each component
  - variantProperties: map of variant name to list of values
  - componentProperties: list of { name, type }
  - textLayers: list of layer names
  - slotLayers: list of layer names
- Save evidence per component to codeConnect/.figma-evidence/<normalized>.json
- Write codeConnect/.figma-evidence/evidence-index.json with original names and normalized names

3) Read the relevant Figma docs and extract rules
- React: https://developers.figma.com/docs/code-connect/react/
- HTML and Angular: https://developers.figma.com/docs/code-connect/html/
- If network access is blocked, ask the user to paste the relevant sections
- Enforce these rules from the docs
  - figma.connect uses an object literal
  - example uses only props defined in props
  - Use figma.children for slots and figma.textContent for text layers
  - Keep JSX or templates valid and minimal

4) Generate Code Connect files
- Use codeConnect/mapping.json as the source of truth for component mapping, see references/mapping-spec.md
- Map props using figma.string, figma.boolean, figma.enum, figma.instance, figma.textContent, figma.children
- Ensure example uses only defined props
- Normalize prop keys to camelCase when they contain spaces or punctuation
- Keep figma.* keys as the original Figma property names
- Write files to codeConnect/<normalized>.figma.tsx for React or codeConnect/<normalized>.figma.ts for Angular

5) Write figma.config.json at repo root
- Follow references/figma-config-spec.md for a fuller config
- Use parser: react for .figma.tsx, html for .figma.ts
- Use include globs for Code Connect files and exclude node_modules, dist, .next

6) Validate using the two-tier validator
- Run node scripts/validate_code_connect.js
  - Single file: node scripts/validate_code_connect.js --code codeConnect/button.figma.tsx --evidence codeConnect/.figma-evidence/button.json
  - Batch: node scripts/validate_code_connect.js --code-dir codeConnect --evidence-dir codeConnect/.figma-evidence
- If evidence is missing, stop and ask for it before proceeding

7) Offer to publish
- Ask before running figma connect publish
- If user wants a dry run, use figma connect publish --dry-run

## Notes
- Avoid global installs unless the user explicitly prefers them
- Keep references one level deep from SKILL.md
- Use forward slashes in all paths
- Never print the raw FIGMA_ACCESS_TOKEN value
