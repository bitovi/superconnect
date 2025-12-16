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

## No JS Expressions in Templates

Code Connect treats snippets as strings—ternaries/operators appear literally, breaking output.

❌ `${disabled ? 'disabled' : ''}` or `${!value}`
✅ Compute in props, reference in template:
```typescript
props: { disabled: figma.enum('State', { 'Disabled': true, 'Default': false }) }
example: ({ disabled }) => html`<input [disabled]="${disabled}">`
```

Arrow must directly return `html\`...\``—no function body, no statements.

## Output

Raw `.figma.ts` only. No markdown fences.
