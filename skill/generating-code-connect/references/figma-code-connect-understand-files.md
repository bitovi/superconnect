---
source_url: https://developers.figma.com/docs/code-connect/quickstart-guide/#understand-code-connect-files
notes: Condensed reference of the Understand Code Connect files section, adjusted for this skill
---

# Understand Code Connect files

## File naming
Code Connect files follow the pattern:
```
component-name.figma.tsx
component-name.figma.ts
```

Where:
- `component-name` matches the component name in code (this skill uses the normalized name from evidence)
- `.figma` marks the file as a Code Connect mapping
- `.tsx` is for React, `.ts` is for HTML and Angular

## File location
This skill writes mappings under `codeConnect/` and keeps evidence under `codeConnect/.figma-evidence/`

## Imports
You import the Code Connect helpers and your component

React example:
```tsx
import figma from "@figma/code-connect/react"
import { Button } from "../path/to/Button"
```

HTML example:
```ts
import figma, { html } from "@figma/code-connect/html"
```

## figma.connect
`figma.connect` connects a code component to a Figma node URL and defines two key sections
- `props` maps Figma properties and variants to code props
- `example` returns the code example shown in Dev Mode

Example (React):
```tsx
figma.connect(Button, "https://www.figma.com/design/FILE?node-id=NODE", {
  props: {
    label: figma.string("Label"),
    disabled: figma.boolean("Disabled"),
    size: figma.enum("Size", {
      Large: "large",
      Medium: "medium",
      Small: "small"
    })
  },
  example: ({ label, disabled, size }) => (
    <Button size={size} disabled={disabled}>{label}</Button>
  )
})
```

## Notes for this skill
- This skill generates mappings directly without interactive setup
- Keep `props` and `example` consistent with your component API
