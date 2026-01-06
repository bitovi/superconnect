import figma, { html } from '@figma/code-connect'

export default figma.connect('https://figma.com/file/dummy-angular?node-id=angular-1', {
  example: () => html`<zap-button></zap-button>`
})