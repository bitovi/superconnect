# Test Patterns for Code Connect Validation

This directory contains fixture `.figma.tsx` files used to validate that generated Code Connect mappings follow expected patterns.

## Purpose

These patterns test that specific Figma properties map to the correct React props with the right helper types. They catch regressions when prompts or AI logic changes unexpectedly.

## Files

- **`patterns-spec.json`** - Defines expected mappings for each fixture
- **`*.figma.tsx`** - Example Code Connect files with specific patterns
- **`DEMO-REGRESSION-DETECTION.md`** - Examples of what regressions look like

## Pattern Examples

### Button: Variant Enumeration Mapping
```tsx
// Figma "Style" variant → React "variant" prop
variant: figma.enum('Style', {
  Primary: 'solid',
  Secondary: 'outline',
  Ghost: 'ghost'
})
```

### Input: Property Name Transformation
```tsx
// Figma "Placeholder Text" → React "placeholder" (space removed)
placeholder: figma.string('Placeholder Text')

// Figma "Input Size" → React "inputSize" (camelCase)
inputSize: figma.enum('Input Size', {...})
```

### Card: Children Slots
```tsx
// Figma slots → React children props
header: figma.children('Header Slot')
content: figma.children('Content Slot')
```

### IconButton: Instance Swap
```tsx
// Figma instance swap → React icon prop
icon: figma.instance('Icon Swap')
```

## How Tests Work

1. **Parse** each `.figma.tsx` file with the Code Connect IR extractor
2. **Extract** actual mappings (Figma axis → React prop, helper type)
3. **Compare** against expected patterns in `patterns-spec.json`
4. **Validate** structural invariants (arrow function, no blocks, no forbidden expressions)

## Adding New Patterns

1. Create a new `.figma.tsx` file in this directory
2. Add entry to `patterns-spec.json`:
   ```json
   {
     "your-component.figma.tsx": {
       "description": "Brief description",
       "expectedMappings": [
         {
           "figmaAxis": "Figma Property Name",
           "reactProp": "reactPropName",
           "helperType": "enum|string|boolean|children|instance",
           "enumKeys": ["Key1", "Key2"]  // Optional, for enums
         }
       ]
     }
   }
   ```
3. Run tests: `pnpm test test/fixture-code-connect-patterns.test.js`

## Pattern Spec Schema

```typescript
{
  "[filename].figma.tsx": {
    description: string;
    expectedMappings: Array<{
      figmaAxis: string;        // Figma property/variant name
      reactProp: string;        // React component prop name
      helperType: "enum" | "string" | "boolean" | "children" | "instance";
      enumKeys?: string[];      // For enum helpers: expected Figma values
    }>;
  };
}
```

## Running Tests

```bash
# Run pattern validation tests only
pnpm test test/fixture-code-connect-patterns.test.js

# Run all tests (includes pattern validation)
pnpm test

# Watch mode for development
pnpm test -- --watch test/fixture-code-connect-patterns.test.js
```

## What's Validated

✅ **Structural:**
- URL is literal string (no templates/variables)
- Config is object literal
- Example is arrow function with direct return
- No forbidden expressions (ternary, logical operators, comparisons)

✅ **Semantic:**
- Correct Figma axis → React prop mapping
- Correct helper type
- For enums: keys match expected Figma variant values
- Expected number of mappings present

## Example Test Output

```
✓ button-variant-mapping.figma.tsx
  ✓ parses without errors
  ✓ has expected structural invariants
  ✓ has expected mappings: Button with Style→variant and Size→size enum mappings
  ✓ validates Figma axis → React prop mappings
```

## Benefits

- **Fast:** No network calls, no Figma CLI
- **Deterministic:** Same results every run
- **Precise:** AST-based (not regex), catches exact issues
- **CI-ready:** Runs in < 1 second
- **Extensible:** Add more patterns easily
