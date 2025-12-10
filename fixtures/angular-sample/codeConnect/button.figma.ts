import figma from '@figma/code-connect';
import { html } from 'lit-html';

figma.connect('https://www.figma.com/design/dummy-angular/Angular%20Fixture?node-id=angular-1', {
  props: {},
  example: (props) => html`<zap-button variant="primary" [options]="[{ label: 'Primary', value: 'primary' }]"></zap-button>`
});
