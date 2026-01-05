Perfect! I found the button component with selector `zap-button`. Since the Figma component has no variant properties, component properties, text layers, or slot layers, this will be a simple Code Connect file with just the basic component mapping.

```typescript
import figma, { html } from '@figma/code-connect'

export default figma.connect('https://figma.com/file/dummy-angular?node-id=angular-1', {
  example: () => html`<zap-button></zap-button>`
})
```