# Mapping spec

## Purpose
Define a single source of truth for mapping Figma components to code components, including property mappings between Figma and code.

## File
codeConnect/mapping.json

## Shape
```json
{
  "framework": "angular",
  "packageName": "@nicholasengineering/zap",
  "figmaFileKey": "ChohwrZwvllBgHWzBslmUg",
  "figmaFileUrl": "https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit",
  "components": [
    {
      "figmaName": "Button",
      "normalizedName": "button",
      "componentSetId": "6:4335",
      "selector": "zap-button",
      "componentPath": "projects/zap/src/lib/components/button/button.component.ts",
      "componentClass": "ZapButton",
      "inputs": [
        { "name": "text", "type": "string" },
        { "name": "size", "type": "enum", "values": ["compact", "wide", "tight", "base"] },
        { "name": "type", "type": "enum", "values": ["info", "success", "warning", "error", "default"] },
        { "name": "variant", "type": "enum", "values": ["outlined", "default", "link"] },
        { "name": "disabled", "type": "boolean" }
      ],
      "figmaToCodeMap": {
        "Size": "size",
        "Type": "type",
        "Variant": "variant",
        "Disabled": "disabled",
        "Label": "text"
      }
    }
  ]
}
```

## Field descriptions

### Top-level fields
- `framework`: "angular" or "react"
- `packageName`: The npm package name for imports (from package.json)
- `figmaFileKey`: Extracted from Figma URL
- `figmaFileUrl`: Base URL for the Figma file (node-id appended per component)

### Component fields
- `figmaName`: Original Figma component set name
- `normalizedName`: Matches evidence filename (from figma-scan.js output)
- `componentSetId`: From evidence, used for node-id in figma.connect URL
- `selector`: Angular selector (zap-button) or React component name
- `componentPath`: Repo-relative path to component source
- `componentClass`: Exported class/function name
- `inputs`: Array of code inputs with types
- `figmaToCodeMap`: Maps Figma property names → code input names

## Extracting code inputs

### Angular
```bash
# Find all inputs in a component file
rg "= input[<\(]" projects/zap/src/lib/components/button/button.component.ts

# Example output:
#   text = input<string>('Submit');
#   size = input<'compact' | 'wide' | 'tight' | 'base'>();
#   disabled = input<boolean>(false);
```

Parse the output to build the inputs array:
- `input<string>` → type: "string"
- `input<boolean>` → type: "boolean"
- `input<'a' | 'b' | 'c'>` → type: "enum", values: ["a", "b", "c"]

### React
```bash
# Find props interface
rg "interface.*Props|type.*Props" src/components/Button.tsx -A 10

# Find destructured props
rg "function.*\(\{.*\}\)" src/components/Button.tsx
```

## Building figmaToCodeMap

Match Figma property names (from evidence) to code input names:

### Matching rules (in priority order)
1. **Exact match (case-insensitive)**: "Size" → "size"
2. **Remove spaces/punctuation**: "Has Icon" → "hasIcon"
3. **Common synonyms**:
   - "Label", "Text", "Title" → "text", "label", "title"
   - "Is Disabled", "Disabled" → "disabled", "isDisabled"
   - "Has Icon", "Show Icon" → "hasIcon", "showIcon", "icon"
4. **If ambiguous**: Prompt user for confirmation

### Example mapping process
Given evidence:
```json
{
  "variantProperties": { "Size": ["Compact", "Base"], "Type": ["Primary", "Secondary"] },
  "componentProperties": [{ "name": "Disabled", "type": "BOOLEAN" }],
  "textLayers": [{ "name": "Label", "type": "TEXT" }]
}
```

And code inputs:
```typescript
size = input<'compact' | 'base'>();
type = input<'primary' | 'secondary'>();
disabled = input<boolean>(false);
text = input<string>('Button');
```

Resulting figmaToCodeMap:
```json
{
  "Size": "size",
  "Type": "type",
  "Disabled": "disabled",
  "Label": "text"
}
```

## Import path discovery

### Angular
```bash
# Get package name
jq -r '.name' projects/zap/package.json
# Output: @nicholasengineering/zap

# Verify component is exported
rg "export.*ZapButton" projects/zap/src/public-api.ts
```

### React
```bash
# Check package.json exports field or main entry
jq '.exports, .main' packages/ui/package.json
```

## Validation rules
- `normalizedName` must match an evidence file in codeConnect/.figma-evidence/
- `componentSetId` must match componentSetId in the evidence file
- Every key in `figmaToCodeMap` must exist in evidence (variantProperties, componentProperties, or textLayers)
- Every value in `figmaToCodeMap` must exist in `inputs`
- `packageName` must be a valid npm package name

## Command line helpers
- List Angular components: `rg -n "@Component\\(" projects`
- List selectors: `rg -n "selector:" projects`
- List Angular inputs: `rg "= input[<\(]" projects --type ts`
- List React exports: `rg -n "export (default )?function|export const" src`
- Find package name: `jq -r '.name' projects/zap/package.json`
