# Code Connect file format

## Purpose
Define the exact output format for Angular Code Connect files so the model can write them directly.

## File naming
- `codeConnect/<normalized-name>.figma.ts`
- Use the normalizedName from evidence (e.g., `button.figma.ts`)

## Template

```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('<FIGMA_URL_WITH_NODE_ID>', {
  props: {
    // Map Figma properties to code props
  },
  example: (props) =>
    html`
<SELECTOR
  [prop]="props.propName"
>
</SELECTOR>`,
  imports: ["import { ComponentClass } from 'package-name'"],
});
```

## URL format
Always include the node-id query parameter:
```
https://www.figma.com/design/<FILE_KEY>/<FILE_NAME>?node-id=<NODE_ID>
```
- Get FILE_KEY from figmaFileUrl in mapping.json
- Get NODE_ID from componentSetId in evidence (convert `:` to `-`)

## Props mapping

### Variant properties → figma.enum
For each entry in `evidence.variantProperties`:
```typescript
propName: figma.enum('Figma Property Name', {
  'Figma Value 1': 'code-value-1',
  'Figma Value 2': 'code-value-2',
})
```
Use `evidence.variantValueEnums[name].enums` for code values if available.

### Boolean properties → figma.boolean
For `componentProperties` with `type: "BOOLEAN"`:
```typescript
disabled: figma.boolean('Disabled')
```

### String properties → figma.string
For `componentProperties` with `type: "STRING"`:
```typescript
label: figma.string('Label')
```

### Instance swap → figma.instance
For `componentProperties` with `type: "INSTANCE_SWAP"`:
```typescript
icon: figma.instance('Icon')
```

### Text layers → figma.textContent
For entries in `evidence.textLayers`:
```typescript
buttonText: figma.textContent('Button Label')
```

### Slot layers → figma.children
For entries in `evidence.slotLayers`:
```typescript
leadingIcon: figma.children('Leading')
```

## Example template (Angular)

### Using Angular property binding syntax
```typescript
example: (props) =>
  html`
<zap-button
  [size]="props.size"
  [variant]="props.variant"
  [disabled]="props.disabled"
>
  ${props.label}
</zap-button>`
```

### For slots/children
```typescript
example: ({ icon, label }) =>
  html`
<zap-button>
  ${icon}
  ${label}
</zap-button>`
```

## Complete example

Given this evidence:
```json
{
  "componentSetId": "6:4335",
  "componentName": "Button",
  "variantProperties": {
    "Size": ["Compact", "Base", "Wide"],
    "Variant": ["Default", "Outlined"]
  },
  "componentProperties": [
    { "name": "Disabled", "type": "BOOLEAN" }
  ],
  "textLayers": [
    { "name": "Label", "type": "TEXT" }
  ],
  "slotLayers": [
    { "name": "Icon", "type": "FRAME" }
  ]
}
```

And this mapping:
```json
{
  "figmaName": "Button",
  "selector": "zap-button",
  "componentClass": "ZapButton",
  "figmaToCodeMap": {
    "Size": "size",
    "Variant": "variant",
    "Disabled": "disabled",
    "Label": "text",
    "Icon": "icon"
  }
}
```

Generate this Code Connect file:
```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('https://www.figma.com/design/ChohwrZwvllBgHWzBslmUg/Zap-UI-Kit?node-id=6-4335', {
  props: {
    size: figma.enum('Size', {
      'Compact': 'compact',
      'Base': 'base',
      'Wide': 'wide',
    }),
    variant: figma.enum('Variant', {
      'Default': 'default',
      'Outlined': 'outlined',
    }),
    disabled: figma.boolean('Disabled'),
    text: figma.textContent('Label'),
    icon: figma.children('Icon'),
  },
  example: ({ size, variant, disabled, text, icon }) =>
    html`
<zap-button
  [size]="size"
  [variant]="variant"
  [disabled]="disabled"
>
  ${icon}
  ${text}
</zap-button>`,
  imports: ["import { ZapButton } from '@nicholasengineering/zap'"],
});
```

## Validation checklist
Before writing a Code Connect file, verify:
- [ ] URL includes node-id from componentSetId
- [ ] Every prop in example is defined in props
- [ ] Figma property names in figma.* calls match evidence exactly
- [ ] Import path matches packageName from mapping.json
- [ ] Selector matches component.selector from mapping.json
- [ ] No empty props object (skip component if no mappable properties)
