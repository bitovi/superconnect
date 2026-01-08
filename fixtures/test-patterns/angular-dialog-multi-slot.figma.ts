import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/test?node-id=5-5', {
  props: {
    headerContent: figma.children('Header'),
    bodyContent: figma.children('Body'),
    footerActions: figma.children('Footer Actions'),
    size: figma.enum('Size', {
      'Small': 'sm',
      'Medium': 'md',
      'Large': 'lg',
      'Full': 'full',
    }),
    showBackdrop: figma.boolean('Show Backdrop'),
    closeOnBackdropClick: figma.boolean('Close On Backdrop Click'),
  },
  example: (props) => html`
    <zap-dialog [size]="${props.size}">
      <zap-dialog-backdrop 
        *ngIf="${props.showBackdrop}"
        [closeOnClick]="${props.closeOnBackdropClick}">
      </zap-dialog-backdrop>
      <zap-dialog-content>
        <zap-dialog-header>
          ${props.headerContent}
          <button zapDialogClose>×</button>
        </zap-dialog-header>
        <zap-dialog-body>
          ${props.bodyContent}
        </zap-dialog-body>
        <zap-dialog-footer>
          ${props.footerActions}
        </zap-dialog-footer>
      </zap-dialog-content>
    </zap-dialog>
  `
})
