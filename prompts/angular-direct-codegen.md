# Angular Direct Codegen

Generate a `.figma.ts` file from the Figma component metadata and Angular component info provided.

The Figma Code Connect API docs follow this prompt—use them as the API reference.

## Rules

**Only use properties from the Figma Component Data section.**
- `componentProperties[]` → `figma.boolean()`, `figma.string()`, `figma.instance()`
- `variantProperties{}` → `figma.enum()`
- `textLayers[]` → `figma.textContent()`
- `slotLayers[]` → `figma.children()`

Don't invent properties that aren't in the data.

**Use the Angular selector** (e.g., `<app-button>`), not the class name (`ButtonComponent`).

**Drop pseudo-state variants** (`state`, `interaction` with values like `hover`, `pressed`, `focused`).

**Map Figma Title Case values to code conventions** (e.g., `Primary` → `primary`).

**Use Angular binding syntax**: `[prop]` for inputs, `(event)` for outputs.

**Use variant restrictions when variant controls structure.**
If a variant changes which elements appear (not just styling), create separate `figma.connect()` calls:
```typescript
figma.connect('url', {
  variant: { type: 'dropzone' },
  example: () => html`<file-upload-dropzone>...</file-upload-dropzone>`
})
figma.connect('url', {
  variant: { type: 'button' },
  example: () => html`<file-upload-button>...</file-upload-button>`
})
```
Don't use conditionals (`${type === 'x' && ...}`) to handle structural variants.

## No JS Expressions in Templates

Code Connect treats snippets as strings—ternaries/operators appear literally, breaking output.

**NEVER use `&&`, `||`, or ternaries in example templates.**

❌ `${disabled ? 'disabled' : ''}`
❌ `${!value}`
❌ `${hasIcon && '<icon />'}`

✅ Compute in props with `figma.boolean()` or `figma.enum()`, reference directly in template:
```typescript
props: { disabled: figma.enum('State', { 'Disabled': true, 'Default': false }) }
example: ({ disabled }) => html`<input [disabled]="${disabled}">`
```

Arrow must directly return `html\`...\``—no function body, no statements.

## Output

Raw `.figma.ts` only. No markdown fences.
