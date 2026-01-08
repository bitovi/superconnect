import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/test?node-id=4-4', {
  props: {
    icon: figma.instance('Icon'),
    text: figma.string('Text'),
    variant: figma.enum('Alert Type', {
      'Info': 'info',
      'Success': 'success',
      'Warning': 'warning',
      'Error': 'error',
    }),
    dismissible: figma.boolean('Can Dismiss'),
    title: figma.string('Title'),
  },
  example: (props) => html`
    <zap-alert [variant]="${props.variant}">
      ${props.icon}
      <zap-alert-title>${props.title}</zap-alert-title>
      <zap-alert-description>${props.text}</zap-alert-description>
      <button 
        *ngIf="${props.dismissible}"
        zapAlertClose
        aria-label="Close">
        <zap-icon name="close"></zap-icon>
      </button>
    </zap-alert>
  `
})
