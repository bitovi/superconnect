import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/dummy-angular/Angular%20Fixture?node-id=angular-1', {
  example: () => html`<zap-button></zap-button>`,
})