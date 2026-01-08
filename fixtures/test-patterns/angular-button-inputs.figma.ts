import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/test?node-id=1-1', {
  props: {
    variant: figma.enum('Variant', {
      'Primary': 'primary',
      'Secondary': 'secondary',
      'Danger': 'danger',
    }),
    size: figma.enum('Size', {
      'Small': 'sm',
      'Medium': 'md',
      'Large': 'lg',
    }),
    disabled: figma.boolean('Disabled'),
    label: figma.string('Label'),
  },
  example: (props) => html`
    <zap-button 
      [variant]="${props.variant}"
      [size]="${props.size}"
      [disabled]="${props.disabled}">
      ${props.label}
    </zap-button>
  `
})
