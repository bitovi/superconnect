---
source_url: https://developers.figma.com/docs/code-connect/html/
notes: Condensed reference for HTML and Angular Code Connect usage
---

# HTML and Angular Code Connect

## Import
```ts
import figma, { html } from "@figma/code-connect/html"
```

## figma.connect example
```ts
figma.connect("https://...", {
  props: {
    label: figma.string("Text Content"),
    disabled: figma.boolean("Disabled"),
    type: figma.enum("Type", {
      Primary: "primary",
      Secondary: "secondary"
    })
  },
  example: ({ disabled, label, type }) => html`\
<ds-button disabled=${disabled} type=${type}>
  ${label}
</ds-button>`
})
```

## Template interpolation rules
- Use `${value}` in the html template
- Boolean attributes render when true and omit when false

## Mapping helpers used by this skill
- `figma.string("Prop")`
- `figma.boolean("Prop")`
- `figma.enum("Prop", { Label: "value" })`
- `figma.instance("Prop")`
- `figma.textContent("Layer")`
- `figma.children("Layer")`

## Notes for this skill
- `example` should only use props defined in `props`
- Keep templates valid and minimal
- Normalize JS prop keys to camelCase while keeping Figma keys unchanged
