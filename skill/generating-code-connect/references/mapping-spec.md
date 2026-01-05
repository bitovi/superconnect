# Mapping spec

## Purpose
Define a single source of truth for mapping Figma components to code components

## File
codeConnect/mapping.json

## Shape
```
{
  "framework": "angular",
  "components": [
    {
      "figmaName": "Dialogue pop up",
      "normalizedName": "dialogue-pop-up",
      "selector": "zap-dialog",
      "componentPath": "projects/zapui/src/lib/dialog/dialog.component.ts",
      "componentName": "ZapDialog"
    }
  ]
}
```

## Rules
- normalizedName must match the evidence filename and Code Connect filename
- Use selector for Angular and componentName for React
- componentPath should be a repo-relative path
- Keep figmaName as the original Figma component name

## Command line helpers
- List Angular components: `rg -n "@Component\\(" projects`
- List selectors: `rg -n "selector:" projects`
- List React exports: `rg -n "export (default )?function|export const" src`
