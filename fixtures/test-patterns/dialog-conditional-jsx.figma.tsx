import figma from '@figma/code-connect/react'
import { DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogDescription, DialogFooter, DialogCloseTrigger, DialogBackdrop, DialogPositioner } from '@chakra-ui/react'

figma.connect(
  DialogRoot,
  'https://www.figma.com/design/test?node-id=2-2',
  {
    props: {
      size: figma.enum('size', {
        xs: 'xs',
        sm: 'sm',
        md: 'md',
        lg: 'lg',
        xl: 'xl',
        full: 'full',
      }),
      closeTrigger: figma.boolean('.closeTrigger?', {
        true: <DialogCloseTrigger />,
        false: undefined,
      }),
      footer: figma.boolean('.footer?', {
        true: <DialogFooter>{figma.children('dialogActions')}</DialogFooter>,
        false: undefined,
      }),
      titleText: figma.textContent('DialogTitle'),
      descriptionText: figma.textContent('Text'),
      bodyContent: figma.children('DialogBody'),
    },
    example: ({ size, closeTrigger, footer, titleText, descriptionText, bodyContent }) => (
      <DialogRoot size={size}>
        <DialogBackdrop />
        <DialogPositioner>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{titleText}</DialogTitle>
              {closeTrigger}
            </DialogHeader>
            <DialogBody>
              <DialogDescription>{descriptionText}</DialogDescription>
              {bodyContent}
            </DialogBody>
            {footer}
          </DialogContent>
        </DialogPositioner>
      </DialogRoot>
    ),
  },
)
