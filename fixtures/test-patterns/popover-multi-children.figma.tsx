import figma from "@figma/code-connect/react"
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverCloseTrigger,
  PopoverHeader,
  PopoverBody,
  PopoverFooter,
  PopoverTitle,
  PopoverDescription,
} from "@chakra-ui/react/popover"

figma.connect(
  PopoverRoot,
  "https://www.figma.com/design/test?node-id=3-3",
  {
    props: {
      size: figma.enum("size", {
        xs: "xs",
        sm: "sm",
        md: "md",
        lg: "lg",
      }),
      showArrow: figma.boolean(".showArrow?"),
      popoverTitle: figma.boolean(".popoverTitle?"),
      title: figma.textContent("PopOver title"),
      description: figma.textContent("PopOver text"),
      contentSlot: figma.children("PopOver content"),
      footerSlot: figma.children("PopOver footer"),
    },
    example: ({ size, showArrow, popoverTitle, title, description, contentSlot, footerSlot }) => (
      <PopoverRoot size={size}>
        <PopoverTrigger />
        <PopoverContent>
          {showArrow && <PopoverArrow />}
          {popoverTitle && <PopoverHeader>{title}</PopoverHeader>}
          <PopoverBody>{description}</PopoverBody>
          <PopoverBody>{contentSlot}</PopoverBody>
          <PopoverFooter>{footerSlot}</PopoverFooter>
          <PopoverCloseTrigger />
        </PopoverContent>
      </PopoverRoot>
    ),
  },
)
