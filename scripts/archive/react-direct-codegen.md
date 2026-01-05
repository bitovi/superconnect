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

**Use variant restrictions when variant controls structure.**
If a variant changes which sub-components appear (not just styling), create separate `figma.connect()` calls:
```tsx
figma.connect(FileUpload, 'url', {
  variant: { type: 'dropzone' },
  example: () => <FileUploadDropzone>...</FileUploadDropzone>
})
figma.connect(FileUpload, 'url', {
  variant: { type: 'button' },
  example: () => <FileUploadTrigger>Button</FileUploadTrigger>
})
```
Don't use conditionals (`{type === 'x' && ...}`) to handle structural variants.

## No JS Expressions in JSX

Code Connect treats snippets as strings—ternaries/operators appear literally, breaking output.

**NEVER use `&&`, `||`, or ternaries in example JSX.**

❌ `{hasIcon && <Icon />}` 
❌ `{icon || <Fallback />}`
❌ `{footer && <Footer>{footer}</Footer>}`
❌ `icon={x ? y : z}`

✅ Compute in props with `figma.boolean()` or `figma.enum()`, reference directly in example:
```tsx
props: { icon: figma.boolean('Has Icon', { true: <Icon />, false: undefined }) }
example: ({ icon }) => <Button>{icon}</Button>  // React handles undefined → renders nothing
```

When `figma.boolean()` maps `false` to `undefined`, just use `{prop}` directly—no `&&` check needed.

Arrow must directly return JSX—no function body, no statements.

## Output

Raw `.figma.tsx` only. No markdown fences.
