Perfect! I found the Button component. The selector is `zap-button` and it's a simple component with no inputs or outputs defined. Since the Figma component data shows no variant properties, component properties, text layers, or slot layers, this will be a very simple Code Connect file.

```typescript
import figma, { html } from '@figma/code-connect'

export default figma.connect('https://figma.com/file/dummy-angular?node-id=angular-1', {
  example: () => html`<zap-button></zap-button>`
})
```