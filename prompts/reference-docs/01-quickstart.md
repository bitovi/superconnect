# Understand Code Connect files

**Source:** https://developers.figma.com/docs/code-connect/quickstart-guide/

Code Connect files are named the following way:

```
component-name.figma.{tsx|kt|swift} (depending on framework)
```

Where:

- `component-name` matches the name of the corresponding component in your codebase.
- `figma` indicates that the file is a Code Connect file.
- `tsx`, `kt`, or `swift` extension matches the framework used for the components. For example, if your codebase consists of React components, your Code Connect files use `tsx`.

Here's an example of a Code Connect file for a React component:

```typescript
import React from "react"
import { Button } from "../ui/primitives/Button/Button"
import figma from "@figma/code-connect"

figma.connect(
  Button,
  "https://www.figma.com/design/Z1bRs3WFkOz26z5bzwtBbA?node-id=65%3A5",
  {
    props: {
      hasIconStart: figma.boolean("Has Icon Start"),
      iconStart: figma.instance("Icon Start"),
      hasIconEnd: figma.boolean("Has Icon End"),
      iconEnd: figma.instance("Icon End"),
      label: figma.string("Label"),
      variant: figma.enum("Variant", {
        Primary: "primary",
        Neutral: "neutral",
        Subtle: "subtle",
      }),
    },
    example: (props) => <Button />,
  }
)
```

## Imports

At the top of the file is an `import` statement for Code Connect. The way Code Connect is imported in the file is based on the framework.

- React: `import figma from "@figma/code-connect"`
- HTML/Web Components: `import { html } from "@figma/code-connect/html"`

The `import` statement lets the Code Connect API be used in the rest of the file. You also will want to import any of the component code to use in your examples later on.

## figma.connect

The component in a Code Connect file is described using the `figma.connect` method. The method takes three arguments: the component imported from your codebase, the URL to the corresponding node in your design system file, and an object that defines the component's properties and a usage example.

- `props` is an object that maps properties in your Figma file to properties of the component in your codebase. The mappings also describe the value types, such as `figma.string` and `figma.boolean`.

  Note: Typically, when you see missing properties, it means that your code is either structured slightly differently or the properties have different names. Either way, it's good to review these unmapped properties to see if they should be accounted for.

- `example` defines how the corresponding code snippet is shown in Dev Mode. By default, the Code Connect files use your code component and the mapped props as the example.
