# React Direct Codegen

Generate a `.figma.tsx` file from the Figma component metadata and React component info provided.

The Figma Code Connect API docs follow this prompt—use them as the API reference.

## Rules

**Only use properties from the Figma Component Data section.**
- `componentProperties[]` → `figma.boolean()`, `figma.string()`, `figma.instance()`
- `variantProperties{}` → `figma.enum()`
- `textLayers[]` → `figma.textContent()`
- `slotLayers[]` → `figma.children()`

Don't invent properties that aren't in the data.

**Match the actual export name from source files.**
If source shows `export const DialogRoot`, use `DialogRoot` in `figma.connect()`, not `Dialog`.

**Import from the package, not internal source paths.**

**Drop pseudo-state variants** (`state`, `interaction` with values like `hover`, `pressed`, `focused`).

**Map Figma Title Case values to code conventions** (e.g., `Primary` → `primary`).

## No JS Expressions in JSX

Code Connect treats snippets as strings—ternaries/operators appear literally, breaking output.

❌ `{hasIcon && <Icon />}` or `icon={x ? y : z}`
✅ Compute in props, reference in example:
```tsx
props: { icon: figma.boolean('Has Icon', { true: <Icon />, false: undefined }) }
example: ({ icon }) => <Button>{icon}</Button>
```

Arrow must directly return JSX—no function body, no statements.

## Output

Raw `.figma.tsx` only. No markdown fences.
