import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/test?node-id=2-2', {
  props: {
    type: figma.enum('Input Type', {
      'Text': 'text',
      'Email': 'email',
      'Password': 'password',
      'Number': 'number',
    }),
    label: figma.string('Label'),
    placeholder: figma.string('Placeholder'),
    helperText: figma.string('Helper Text'),
    required: figma.boolean('Required'),
    showError: figma.boolean('Show Error'),
    errorMessage: figma.string('Error Message'),
  },
  example: (props) => html`
    <zap-form-field>
      <label zapLabel>${props.label}</label>
      <input 
        zapInput
        type="${props.type}"
        placeholder="${props.placeholder}"
        [required]="${props.required}" />
      <zap-hint>${props.helperText}</zap-hint>
      <zap-error *ngIf="${props.showError}">${props.errorMessage}</zap-error>
    </zap-form-field>
  `
})
