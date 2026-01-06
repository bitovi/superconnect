---
source_url: https://developers.figma.com/docs/code-connect/react/
notes: Condensed reference for React Code Connect usage
---

# React Code Connect

## Import
```tsx
import figma from "@figma/code-connect/react"
```

## figma.connect signatures
```tsx
// Connect a code component to a Figma node
figma.connect(Button, "https://...", { /* mapping */ })

// Connect a native element to a Figma node
figma.connect("https://...", {
  example: () => <button>click me</button>
})
```

## Mapping helpers used by this skill
- `figma.string("Prop")` for text values
- `figma.boolean("Prop")` for boolean properties or boolean variants
- `figma.enum("Prop", { Label: "value" })` for variant enums
- `figma.instance("Prop")` for instance swap properties
- `figma.textContent("Layer")` for text layers
- `figma.children("Layer")` for slots

## Example structure
```tsx
figma.connect(Button, "https://...", {
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
- `example` should only use props defined in `props`
- Keep JSX valid and minimal
- Normalize JS prop keys to camelCase while keeping Figma keys unchanged
