import figma from '@figma/code-connect/react'
import { Button } from '../components/Button'

figma.connect(Button, 'https://www.figma.com/design/test/file?node-id=1-2', {
  props: {
    variant: figma.enum('Style', {
      Primary: 'solid',
      Secondary: 'outline',
      Ghost: 'ghost'
    }),
    size: figma.enum('Size', {
      Small: 'sm',
      Medium: 'md',
      Large: 'lg'
    }),
    label: figma.string('Label')
  },
  example: (props) => <Button variant={props.variant} size={props.size}>{props.label}</Button>
})
