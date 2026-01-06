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

2) Extract Figma data with figma-scan.js
- Use the bundled script for reliable extraction:
  ```bash
  node scripts/figma-scan.js <figmaFileUrl> \
    --token $FIGMA_ACCESS_TOKEN \
    --output codeConnect/.figma-evidence \
    --index codeConnect/.figma-evidence/figma-components-index.json
  ```
- The script handles all Figma API complexity including:
  - Fetching componentPropertyDefinitions via /v1/files/:key/nodes endpoint
  - Parsing variant properties from component names
  - Extracting text layers for figma.textContent()
  - Extracting slot layers for figma.children()
  - Normalizing property names to camelCase
- Do NOT use raw curl + jq for extraction - the API has edge cases the script handles
- See references/figma-extraction-spec.md for output format details

### Evidence output structure
Each evidence file contains:
```json
{
  "schemaVersion": "figma-component@1",
  "componentSetId": "6:4335",
  "componentName": "Button",
  "variantProperties": { "Size": ["Compact", "Base", "Wide"] },
  "variantValueEnums": {
    "Size": { "normalizedKey": "size", "enums": ["compact", "base", "wide"] }
  },
  "componentProperties": [
    { "name": "Disabled", "type": "BOOLEAN" },
    { "name": "Label", "type": "STRING" }
  ],
  "textLayers": [{ "name": "Label", "type": "TEXT" }],
  "slotLayers": [{ "name": "Icon", "type": "FRAME" }]
}
```

### Evidence quality gate
Before proceeding to generation, verify evidence is not empty:
```bash
for f in codeConnect/.figma-evidence/*.json; do
  props=$(jq '.variantProperties | length' "$f")
  comps=$(jq '.componentProperties | length' "$f")
  if [ "$props" -eq 0 ] && [ "$comps" -eq 0 ]; then
    echo "WARNING: Empty evidence for $f"
  fi
done
```
If evidence is empty, the script may need --layer-depth increased or the Figma component genuinely has no configurable properties.

3) Extract code component inputs
- For Angular, find all inputs in each component:
  ```bash
  rg "= input[<\(]" projects/zap/src/lib/components/button/button.component.ts
  ```
- For React, find props interface or destructured props:
  ```bash
  rg "interface.*Props|type.*Props|function.*\(\{" src/components/Button.tsx
  ```
- Update codeConnect/mapping.json with discovered inputs, see references/mapping-spec.md

### Mapping Figma to code
Create figmaToCodeMap in mapping.json to link Figma property names to code input names:
```json
{
  "figmaToCodeMap": {
    "Size": "size",
    "Disabled": "disabled",
    "Label": "text"
  }
}
```
Use these heuristics for matching:
1. Case-insensitive match first (Size → size)
2. Remove spaces and normalize (Has Icon → hasIcon)
3. Common synonyms (Label → text, Title → heading)
4. If ambiguous, prompt the user for confirmation

4) Read the relevant Figma docs and extract rules
- React: https://developers.figma.com/docs/code-connect/react/
- HTML and Angular: https://developers.figma.com/docs/code-connect/html/
- If network access is blocked, ask the user to paste the relevant sections
- Enforce these rules from the docs:
  - figma.connect uses an object literal
  - example uses only props defined in props
  - Use figma.children for slots and figma.textContent for text layers
  - Keep JSX or templates valid and minimal

### Angular-specific syntax rules
Use Angular property binding syntax in examples:
```typescript
// ✅ CORRECT - Angular property binding
html`<zap-button [disabled]="props.disabled" [size]="props.size">`

// ❌ WRONG - HTML attribute syntax
html`<zap-button disabled=${props.disabled} size="${props.size}">`
```

For content projection with slots, use figma.children:
```typescript
props: {
  icon: figma.children('Icon'),
},
example: ({ icon }) => html`<zap-button>${icon}</zap-button>`
```

5) Write Code Connect files directly
- Follow references/code-connect-format.md for exact file structure
- Read evidence from codeConnect/.figma-evidence/<normalized>.json
- Read component info from codeConnect/mapping.json
- Write files directly to codeConnect/<normalized>.figma.ts (Angular) or .figma.tsx (React)

### For each component:
1. Read the evidence file to get Figma properties
2. Read the mapping entry to get selector, componentClass, figmaToCodeMap
3. Build the props object mapping Figma properties to code props
4. Build the example template using Angular property binding syntax
5. Write the complete Code Connect file

### Prop mapping rules:
- `figma.enum('PropName', {...})` for variantProperties
- `figma.boolean('PropName')` for BOOLEAN componentProperties
- `figma.string('PropName')` for STRING componentProperties
- `figma.textContent('LayerName')` for textLayers
- `figma.children('LayerName')` for slotLayers
- `figma.instance('PropName')` for INSTANCE_SWAP componentProperties

### URL must include node-id
Every figma.connect() call MUST include the node-id query parameter:
```typescript
// ✅ CORRECT - includes node-id from componentSetId
figma.connect('https://www.figma.com/design/FILE_KEY/Name?node-id=6-4335', {...})

// ❌ WRONG - missing node-id
figma.connect('https://www.figma.com/design/FILE_KEY/Name', {...})
```
Use the componentSetId from evidence files, converting colon to hyphen (6:4335 → 6-4335).

### Import path discovery
Do not guess import paths. Derive them from the actual package:
```bash
# Find the package name
jq -r '.name' projects/zap/package.json

# Find exported components
rg "export \* from|export \{" projects/zap/src/public-api.ts
```

Write files to codeConnect/<normalized>.figma.tsx for React or codeConnect/<normalized>.figma.ts for Angular

6) Write figma.config.json at repo root
- Follow references/figma-config-spec.md for a fuller config
- Use parser: react for .figma.tsx, html for .figma.ts
- Use include globs for Code Connect files and exclude node_modules, dist, .next

7) Validate using the two-tier validator
- Run node scripts/validate_code_connect.js
  - Single file: node scripts/validate_code_connect.js --code codeConnect/button.figma.tsx --evidence codeConnect/.figma-evidence/button.json
  - Batch: node scripts/validate_code_connect.js --code-dir codeConnect --evidence-dir codeConnect/.figma-evidence
- If evidence is missing, stop and ask for it before proceeding

### Do not generate empty Code Connect files
If props cannot be determined, either prompt for manual input or skip the component:
```typescript
// ❌ NEVER generate this - provides no value
figma.connect('...', {
  props: {},
  example: () => html`<zap-button></zap-button>`
})
```

8) Offer to publish
- Ask before running figma connect publish
- If user wants a dry run, use figma connect publish --dry-run

## Prerequisites
For figma-scan.js, ensure dependencies are available:
```bash
npm install commander chalk json-stringify-pretty-compact
```

## Notes
- Write Code Connect files directly - do not use a generator script
- Avoid global installs unless the user explicitly prefers them
- Keep references one level deep from SKILL.md
- Use forward slashes in all paths
- Never print the raw FIGMA_ACCESS_TOKEN value
- The figma-scan.js script filters hidden components (prefixed with . or _)
- Use componentSetId from evidence for node-id URLs, not individual variant IDs
