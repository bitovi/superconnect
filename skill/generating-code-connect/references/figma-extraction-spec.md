# Figma extraction spec

## Purpose
Define how to extract component evidence from Figma and store it in a consistent format

## Inputs
- Figma file URL or file key
- FIGMA_ACCESS_TOKEN
- Optional component scope list

## Output layout
- codeConnect/.figma-evidence/
  - evidence-index.json
  - <normalized>.json

## Canonical name normalization
- Lowercase
- Replace any run of non-alphanumeric characters with a single hyphen
- Trim leading and trailing hyphens
- Examples
  - "Dialogue pop up" -> "dialogue-pop-up"
  - "Radio button" -> "radio-button"
  - "Input field" -> "input-field"

## Evidence JSON shape
```
{
  "name": "Dialogue pop up",
  "normalizedName": "dialogue-pop-up",
  "figmaId": "123:456",
  "variantProperties": { "Size": ["Sm", "Md", "Lg"] },
  "componentProperties": [
    { "name": "Supporting text", "type": "TEXT" },
    { "name": "Icon", "type": "INSTANCE_SWAP" }
  ],
  "textLayers": ["Label", "Supporting text"],
  "slotLayers": ["Icon", "Leading", "Trailing"]
}
```

## evidence-index.json shape
```
{
  "components": [
    {
      "name": "Dialogue pop up",
      "normalizedName": "dialogue-pop-up",
      "figmaId": "123:456",
      "evidenceFile": "dialogue-pop-up.json"
    }
  ]
}
```

## Extraction steps
1) Parse file key from the URL
2) Validate token against the file endpoint: /v1/files/<fileKey>
3) Use the Figma API to list component sets and components
4) For each component, fetch node data and extract:
- componentProperties from componentPropertyDefinitions or componentProperties
- variantProperties from the component set definitions
- textLayers by walking TEXT nodes
- slotLayers by walking INSTANCE nodes or slot layers defined in the component
5) Save evidence JSON using the normalized name
6) Save evidence-index.json with original and normalized names

## Tooling hints
- Use curl + jq for quick inspection and filtering
- Use jq to verify fields in extracted JSON
- Use rg to find existing Code Connect files or component names in the repo

## Notes
- If the API data fields differ, follow the official Figma REST API docs
- Keep evidence file names aligned with normalized names to avoid mismatch
