import figma, { html } from '@figma/code-connect/html'

figma.connect('https://www.figma.com/design/test?node-id=3-3', {
  props: {
    tabs: figma.children('Tabs'),
    activeIndex: figma.enum('Active Tab', {
      'First': '0',
      'Second': '1',
      'Third': '2',
    }),
    orientation: figma.enum('Orientation', {
      'Horizontal': 'horizontal',
      'Vertical': 'vertical',
    }),
  },
  example: (props) => html`
    <zap-tab-group 
      [selectedIndex]="${props.activeIndex}"
      [orientation]="${props.orientation}">
      <zap-tab-list>
        ${props.tabs}
      </zap-tab-list>
      <zap-tab-panels>
        <zap-tab-panel>Content 1</zap-tab-panel>
        <zap-tab-panel>Content 2</zap-tab-panel>
        <zap-tab-panel>Content 3</zap-tab-panel>
      </zap-tab-panels>
    </zap-tab-group>
  `
})
