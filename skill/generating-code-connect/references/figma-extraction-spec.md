# Figma extraction spec

## Purpose
Define how to extract component evidence from Figma and store it in a consistent format

## Extraction method
Use the bundled `scripts/figma-scan.js` script for all Figma data extraction:
```bash
node scripts/figma-scan.js <figmaFileUrl> \
  --token $FIGMA_ACCESS_TOKEN \
  --output codeConnect/.figma-evidence \
  --index codeConnect/.figma-evidence/figma-components-index.json \
  --layer-depth 3
```

Do NOT use raw curl + jq for extraction. The script handles:
- Fetching componentPropertyDefinitions via /v1/files/:key/nodes endpoint when missing
- Parsing variant properties from component variant names (e.g., "Size=Large, Type=Primary")
- Traversing component trees for TEXT and slot layers
- Filtering hidden components (prefixed with . or _)
- Normalizing names and creating checksums

## Inputs
- Figma file URL or file key
- FIGMA_ACCESS_TOKEN
- Optional --layer-depth for deeper traversal (default 3)

## Output layout
- codeConnect/.figma-evidence/
  - figma-components-index.json (canonical index)
  - <normalized>.json (one per component set)

## Canonical name normalization (handled by script)
- Lowercase
- Replace any run of non-alphanumeric characters with underscore
- Collapse multiple underscores
- Examples
  - "Dialogue pop up" -> "dialogue_pop_up"
  - "Radio button" -> "radio_button"
  - "Input field" -> "input_field"

## Evidence JSON shape (figma-component@1 schema)
```json
{
  "schemaVersion": "figma-component@1",
  "checksum": {
    "algorithm": "sha256",
    "value": "abc123..."
  },
  "componentSetId": "6:4335",
  "componentName": "Button",
  "variantProperties": {
    "Size": ["Compact", "Base", "Wide"],
    "Type": ["Primary", "Secondary", "Danger"]
  },
  "variantValueEnums": {
    "Size": {
      "normalizedKey": "size",
      "rawKeys": ["Size"],
      "values": ["Compact", "Base", "Wide"],
      "enums": ["compact", "base", "wide"]
    }
  },
  "componentProperties": [
    { "name": "Disabled", "type": "BOOLEAN", "defaultValue": false },
    { "name": "Label", "type": "STRING" },
    { "name": "Icon", "type": "INSTANCE_SWAP" }
  ],
  "textLayers": [
    { "name": "Label", "type": "TEXT", "characters": "Button" }
  ],
  "slotLayers": [
    { "name": "Icon", "type": "FRAME" },
    { "name": "Leading", "type": "FRAME" }
  ],
  "variants": [
    {
      "variantId": "6:4336",
      "name": "Size=Compact, Type=Primary",
      "properties": { "size": "Compact", "type": "Primary" },
      "rawProperties": { "Size": "Compact", "Type": "Primary" }
    }
  ],
  "totalVariants": 9,
  "nameAliases": {
    "canonical": "Button",
    "alias": "Button",
    "candidates": ["Button"]
  },
  "breadcrumbs": {
    "fullPath": ["Components", "Buttons"],
    "path": "Components / Buttons"
  }
}
```

### Key fields for Code Connect generation
- `componentSetId`: Use for node-id URL parameter (convert : to -)
- `variantProperties`: Map to figma.enum() calls
- `variantValueEnums.*.enums`: Use as code-side enum values
- `componentProperties`: Map to figma.boolean(), figma.string(), figma.instance()
- `textLayers`: Map to figma.textContent() calls
- `slotLayers`: Map to figma.children() calls

## Index file shape (figma-component-index@1 schema)
```json
{
  "schemaVersion": "figma-component-index@1",
  "fileName": "Zap UI Kit",
  "fileKey": "ChohwrZwvllBgHWzBslmUg",
  "fileUrl": "https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg",
  "version": "1234567890",
  "lastModified": "2025-01-05T00:00:00Z",
  "exportDate": "2025-01-05T14:30:00Z",
  "components": [
    {
      "name": "Button",
      "id": "6:4335",
      "variantCount": 9,
      "checksum": "abc123...",
      "schemaVersion": "figma-component@1",
      "alias": "Button",
      "breadcrumbPath": "Components / Buttons"
    }
  ]
}
```

## Evidence quality validation
Before proceeding to Code Connect generation, validate evidence:
```bash
# Check for empty evidence
for f in codeConnect/.figma-evidence/*.json; do
  [ "$(basename "$f")" = "figma-components-index.json" ] && continue
  variants=$(jq '.variantProperties | length' "$f")
  props=$(jq '.componentProperties | length' "$f")
  text=$(jq '.textLayers | length' "$f")
  if [ "$variants" -eq 0 ] && [ "$props" -eq 0 ] && [ "$text" -eq 0 ]; then
    echo "WARNING: Empty evidence for $(basename "$f")"
  fi
done
```

If evidence is empty:
1. Try increasing --layer-depth (up to 5)
2. Verify the component is a COMPONENT_SET not a standalone COMPONENT
3. Some components genuinely have no configurable properties - flag for manual review

## Troubleshooting

### Token errors (401/403)
- Verify FIGMA_ACCESS_TOKEN is set and has file_content:read scope
- Token may have expired - regenerate at https://www.figma.com/developers/api#access-tokens

### Empty componentProperties
- The script automatically fetches /v1/files/:key/nodes?ids= for missing definitions
- If still empty, the component may not have configurable properties

### Network errors in corporate environments
- Set HTTP_PROXY and HTTPS_PROXY if behind a proxy
- The script provides detailed network troubleshooting guidance

## Notes
- If the API data fields differ, follow the official Figma REST API docs
- Keep evidence file names aligned with normalized names to avoid mismatch
