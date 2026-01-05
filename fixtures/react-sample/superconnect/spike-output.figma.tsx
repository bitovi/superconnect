Since I cannot access the repository files to find the actual FixtureComponent implementation, I'll generate a Code Connect file based on the Figma component data provided. I'll make reasonable assumptions about the component structure and import path.

Based on the Figma component data, here's the Code Connect file:

```tsx
import figma from '@figma/code-connect'
import { FixtureComponent } from './FixtureComponent'

export default figma.connect(FixtureComponent, 'https://figma.com/file/dummy-react?node-id=react-1', {
  props: {
    variant: figma.enum('variant', {
      primary: 'primary',
      secondary: 'secondary'
    }),
    label: figma.string('label'),
    disabled: figma.boolean('disabled')
  },
  example: ({ variant, label, disabled }) => (
    <FixtureComponent variant={variant} disabled={disabled}>
      {label}
    </FixtureComponent>
  )
})
```