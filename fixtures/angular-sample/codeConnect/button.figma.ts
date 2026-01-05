Perfect! I found the ZapButtonComponent with selector `zap-button`. Since the Figma component data shows no variant properties, component properties, text layers, or slot layers, this is a simple button component with no inputs.

Based on the component file analysis:
- Selector: `zap-button`
- No @Input() properties found
- No @Output() events found
- No variants or properties to map

```typescript
import figma, { html } from '@figma/code-connect'

export default figma.connect('https://figma.com/file/dummy-angular?node-id=angular-1', {
  example: () => html`<zap-button></zap-button>`
})
```