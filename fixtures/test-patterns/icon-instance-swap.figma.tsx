import figma from '@figma/code-connect/react'
import { IconButton } from '../components/IconButton'

figma.connect(IconButton, 'https://www.figma.com/design/test/file?node-id=4-5', {
  props: {
    icon: figma.instance('Icon Swap'),
    ariaLabel: figma.string('aria-label')
  },
  example: (props) => <IconButton icon={props.icon} aria-label={props.ariaLabel} />
})
