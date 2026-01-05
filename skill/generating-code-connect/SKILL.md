---
name: generating-code-connect
description: Generates Figma Code Connect mappings for React or Angular repos, validates them with pre-checks and the Figma CLI, and can publish via figma connect. Use when a user provides a Figma file URL and a component repo and asks for Code Connect files, figma.config.json, or validation.
---

# Generating Code Connect

## Scope
Create Code Connect files, write figma.config.json, validate mappings, and optionally publish

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
1) Detect framework
- Read package.json and look for react or @angular/core
- If ambiguous, ask the user to choose

2) Get Figma data
- Prefer an MCP server if available and use fully qualified tool names ServerName:tool_name
- Otherwise use the Figma REST API with FIGMA_ACCESS_TOKEN
- Extract evidence for each component
  - variantProperties: map of variant name to list of values
  - componentProperties: list of { name, type }
  - textLayers: list of layer names
  - slotLayers: list of layer names
- Save evidence per component to codeConnect/.figma-evidence/<Component>.json

3) Read the relevant Figma docs and extract rules
- React: https://developers.figma.com/docs/code-connect/react/
- HTML and Angular: https://developers.figma.com/docs/code-connect/html/
- If network access is blocked, ask the user to paste the relevant sections

4) Generate Code Connect files
- Use figma.connect with an object literal
- Map props using figma.string, figma.boolean, figma.enum, figma.instance, figma.textContent, figma.children
- Ensure example uses only defined props
- Write files to codeConnect/<Component>.figma.tsx for React or codeConnect/<Component>.figma.ts for Angular

5) Write figma.config.json at repo root
- parser: react for .figma.tsx, html for .figma.ts
- include: ["codeConnect/*.figma.tsx"] or ["codeConnect/*.figma.ts"]

6) Validate using the two-tier validator
- Run scripts/check_figma_cli.sh
- Run node scripts/validate_code_connect.js
  - Single file: node scripts/validate_code_connect.js --code codeConnect/Button.figma.tsx --evidence codeConnect/.figma-evidence/Button.json
  - Batch: node scripts/validate_code_connect.js --code-dir codeConnect --evidence-dir codeConnect/.figma-evidence
- If evidence is missing, stop and ask for it before proceeding

7) Offer to publish
- Ask before running figma connect publish
- If user wants a dry run, use figma connect publish --dry-run

## Notes
- Avoid global installs unless the user explicitly prefers them
- Keep references one level deep from SKILL.md
- Use forward slashes in all paths
