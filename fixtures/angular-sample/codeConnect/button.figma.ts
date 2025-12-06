import figma from '@figma/code-connect';
import { html } from 'lit-html';

figma.connect('https://www.figma.com/design/dummy-angular/Angular%20Fixture?node-id=angular-1', {
  props: {
    variant: figma.enum('variant', {"primary":"primary","secondary":"secondary"}),
    options: figma.string('options'),
  },
  example: (props) => html`<zap-button [variant]="'primary'" [options]="[{ label: 'Primary', value: 'primary' }]"></zap-button>`
});
