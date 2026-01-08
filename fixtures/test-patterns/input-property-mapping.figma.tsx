import figma from '@figma/code-connect/react'
import { Input } from '../components/Input'

figma.connect(Input, 'https://www.figma.com/design/test/file?node-id=2-3', {
  props: {
    placeholder: figma.string('Placeholder Text'),
    disabled: figma.boolean('Is Disabled'),
    inputSize: figma.enum('Input Size', {
      Small: 'sm',
      Large: 'lg'
    })
  },
  example: (props) => <Input placeholder={props.placeholder} disabled={props.disabled} size={props.inputSize} />
})
