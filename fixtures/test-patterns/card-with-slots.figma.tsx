import figma from '@figma/code-connect/react'
import { Card, CardHeader, CardBody } from '../components/Card'

figma.connect(Card, 'https://www.figma.com/design/test/file?node-id=3-4', {
  props: {
    header: figma.children('Header Slot'),
    content: figma.children('Content Slot'),
    elevation: figma.enum('Elevation', {
      Flat: '0',
      Raised: '2',
      Floating: '4'
    })
  },
  example: (props) => (
    <Card elevation={props.elevation}>
      <CardHeader>{props.header}</CardHeader>
      <CardBody>{props.content}</CardBody>
    </Card>
  )
})
