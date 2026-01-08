# Demo: Pattern Validation Tests Catching Regressions

This demonstrates how the pattern validation tests detect when AI/prompts generate incorrect mappings.

## Scenario: Button's Style Variant Changes

### Current (Correct) Mapping
```tsx
// fixtures/test-patterns/button-variant-mapping.figma.tsx
figma.connect(Button, 'url', {
  props: {
    variant: figma.enum('Style', {
      Primary: 'solid',
      Secondary: 'outline',
      Ghost: 'ghost'
    })
  }
})
```

**Test passes:** ✅ Figma "Style" → React "variant"

---

## Regression Example 1: Wrong Prop Name

If your prompt changes and generates:
```tsx
props: {
  buttonStyle: figma.enum('Style', {  // ❌ Changed from 'variant'
    Primary: 'solid',
    Secondary: 'outline',
    Ghost: 'ghost'
  })
}
```

**Test fails:**
```
❌ button-variant-mapping.figma.tsx › validates Figma axis → React prop mappings

expect(received).toEqual(expected)

Expected: {figmaAxis: "Style", reactProp: "variant", helperType: "enum"}
Received: {figmaAxis: "Style", reactProp: "buttonStyle", helperType: "enum"}
```

---

## Regression Example 2: Wrong Enum Keys

If your prompt generates incorrect Figma variant values:
```tsx
props: {
  variant: figma.enum('Style', {
    Filled: 'solid',      // ❌ Should be 'Primary'
    Outlined: 'outline',  // ❌ Should be 'Secondary'
    Minimal: 'ghost'      // ❌ Should be 'Ghost'
  })
}
```

**Test fails:**
```
❌ button-variant-mapping.figma.tsx › has expected mappings

Expected enum keys to contain: "Primary"
Received keys: ["Filled", "Outlined", "Minimal"]
```

---

## Regression Example 3: Wrong Helper Type

If your prompt generates the wrong helper:
```tsx
props: {
  variant: figma.string('Style')  // ❌ Should be figma.enum()
}
```

**Test fails:**
```
❌ button-variant-mapping.figma.tsx › validates Figma axis → React prop mappings

expect(received).toEqual(expected)

Expected: {helperType: "enum"}
Received: {helperType: "string"}
```

---

## Regression Example 4: Structural Issues

If your prompt generates forbidden patterns:
```tsx
example: (props) => {
  const variant = props.variant;  // ❌ Block body not allowed
  return <Button variant={variant} />
}
```

**Test fails:**
```
❌ button-variant-mapping.figma.tsx › has expected structural invariants

expect(received).toBe(expected)

Expected: hasBlock = false
Received: hasBlock = true
```

---

## How to Test This Yourself

1. **Edit a fixture file** in `fixtures/test-patterns/`
2. **Change a mapping** (prop name, enum key, helper type)
3. **Run tests:**
   ```bash
   pnpm test test/fixture-code-connect-patterns.test.js
   ```
4. **See it fail** with precise error message
5. **Revert the change** and tests pass again

---

## What Gets Validated

For each fixture pattern:

✅ **Structure:**
- URL is a literal string
- Config is object literal
- Example is arrow function with direct return
- No forbidden expressions (ternary, logical ops)

✅ **Mappings:**
- Correct Figma axis → React prop
- Correct helper type (enum, string, boolean, children, instance)
- Correct enum keys (match Figma variant values)

✅ **Count:**
- Expected number of props
- All expected mappings present

---

## CI Integration

These tests run automatically:
```yaml
# In CI pipeline
- name: Test
  run: pnpm test
  # Includes pattern validation tests
  # Fails if mappings don't match expected patterns
```

**Result:** Any prompt changes that alter mapping logic will be caught immediately.
