# React Direct Codegen

Generate a `.figma.tsx` file from the Figma component metadata and React component info provided.

## Rules

Code Connect examples are **static templates**, not executable code. They will be displayed as-is in Figma's Dev Mode. This means:

- Examples don't need to actually run or compile
- It's OK to omit required props if they can't be mapped from Figma
- Some components need data props (collections, arrays, items) that can't come from Figma. **Hardcode example data inline** rather than trying to compute it

**Import Instructions:**

{{IMPORT_INSTRUCTIONS}}

**Only use properties from the Figma Component Data section.**
- `componentProperties[]` → `figma.boolean()`, `figma.string()`, `figma.instance()`
- `variantProperties{}` → `figma.enum()`
- `textLayers[]` → `figma.textContent()`
- `slotLayers[]` → `figma.children()`

Don't invent properties that aren't in the data.

**Match the actual export name from source files.**
If source shows `export const DialogRoot`, use `DialogRoot` in `figma.connect()`, not `Dialog`.

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

**NEVER use ternaries. EVER.**
Code Connect files aren't executed — they're parsed by Figma's static analyzer to extract the component structure. Ternary expressions require runtime evaluation, which breaks static analysis. Instead, prefer the figma.boolean() function, which is a declarative way to express the same thing.

**Also NEVER use `&&` or `||`.**

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
