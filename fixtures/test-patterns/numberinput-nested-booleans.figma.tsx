import figma from '@figma/code-connect/react'
import {
  NumberInputRoot,
  NumberInputLabel,
  NumberInputInput,
  NumberInputControl,
  NumberInputIncrementTrigger,
  NumberInputDecrementTrigger,
} from '@chakra-ui/react'

figma.connect(NumberInputRoot, 'https://www.figma.com/design/test?node-id=1-1', {
  props: {
    size: figma.enum('size', {
      'xs': 'xs',
      'sm': 'sm',
      'md': 'md',
      'lg': 'lg',
    }),
    variant: figma.enum('variant', {
      'outline': 'outline',
      'filled': 'filled',
      'Flushed': 'flushed',
    }),
    label: figma.textContent('Label'),
    helperText: figma.boolean('.helperText?', {
      true: figma.textContent('helperText'),
      false: undefined,
    }),
    isRequired: figma.boolean('.isRequired?', {
      true: true,
      false: false,
    }),
    isInvalid: figma.boolean('.isInvalid?', {
      true: true,
      false: false,
    }),
  },
  example: ({ size, variant, label, helperText, isRequired, isInvalid }) => (
    <NumberInputRoot size={size} variant={variant} required={isRequired} invalid={isInvalid}>
      <NumberInputLabel>{label}</NumberInputLabel>
      <NumberInputControl>
        <NumberInputInput />
        <NumberInputIncrementTrigger />
        <NumberInputDecrementTrigger />
      </NumberInputControl>
      {helperText && <div>{helperText}</div>}
    </NumberInputRoot>
  ),
})
