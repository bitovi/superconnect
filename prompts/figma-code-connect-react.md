# Connecting React components

This guide helps you connect your React (or React Native) components with Figma components using Code Connect. Code Connect for React works as both a standalone implementation and as an integration with existing Storybook files to enable easily maintaining both systems in parallel.

> **Important:** Code Connect files are not executed. While they're written using real components from your codebase, the Figma CLI essentially treats code snippets as strings. This means you can, for example, use hooks without needing to mock data.
>
> However, this also means that logical operators such as ternaries or conditionals will be output verbatim in your example code rather than executed to show the result. You aren't able to dynamically construct `figma.connect` calls in a for-loop, as another example.

## Dynamic code snippets

If you completed Getting Started with Code Connect, you should have a connected code snippet visible in Dev Mode when inspecting instances of that component. However, the code snippet doesn't yet reflect the entirety of the design.

To ensure the connected code snippet accurately reflects the design, you need to make use of property mappings. This enables you to link specific props in the design to props in code. In most cases, design and code props don't match 1:1, so it's necessary for us to configure this to ensure the correct code is shown in Dev Mode.

Here is a simple example for a button with a `label`, `disabled`, and `type` property.

```tsx
import figma from '@figma/code-connect/react'

figma.connect(Button, 'https://...', {
  props: {
    label: figma.string('Text Content'),
    disabled: figma.boolean('Disabled'),
    type: figma.enum('Type', {
      Primary: 'primary',
      Secondary: 'secondary',
    }),
  },
  example: ({ disabled, label, type }) => {
    return (
      <Button disabled={disabled} type={type}>
        {label}
      </Button>
    )
  },
})
```

## The `figma` import

The `figma` import contains helpers for mapping all sorts of properties from design to code. They work for simple mappings where only the naming differs between Figma and code, as well as more complex mappings where the type differs. See the following reference for all the Code Connect helpers that exist and the ways you can use them to connect Figma and code.

### `figma.connect`

`figma.connect()` has two signatures for connecting components.

```tsx
// connect a component in code to a Figma component
figma.connect(Button, "https://...")

// connect a Figma component to a native element
figma.connect("https://...")
```

The second option is useful if you want to just render a HTML tag instead of a React component.

The first argument is used to determine where your component lives in code, in order to generate an import statement for the component. This isn't needed if you just want to render something like a `button` tag. For example:

```tsx
figma.connect("https://...", {
  example: () => <button>click me</button>
})
```

### Strings

Strings are the simplest value to map from Figma to code. Call `figma.string` with the Figma prop name you want to reference as a parameter. This is useful for things like button labels, header titles, tooltips, etc.

```tsx
figma.string('Title')
```

### Booleans

Booleans work similar to strings. However Code Connect also provides helpers for mapping booleans in Figma to more complex types in code. For example you may want to map a Figma boolean to the existence of a specific sublayer in code. In addition to mapping boolean props, `figma.boolean` can be used to map boolean Variants in Figma. A boolean Variant is a Variant with only two options that are either "Yes"/"No", "True"/"False" or "On"/Off". For `figma.boolean` these values are normalized to `true` and `false`.

```tsx
// simple mapping of boolean from figma to code
figma.boolean('Has Icon')

// map a boolean value to one of two options of any type
figma.boolean('Has Icon', {
  true: <Icon />,
  false: <Spacer />,
})
```

In some cases, you only want to render a certain prop if it matches some value in Figma. You can do this either by passing a partial mapping object, or setting the value to `undefined`.

```tsx
// Don't render the prop if 'Has label' in figma is `false`
figma.boolean('Has label', {
  true: figma.string('Label'),
  false: undefined,
})
```

### Enums

Variants (or enums) in Figma are commonly used to control the look and feel of components that require more complex options than a simple boolean toggle. Variant properties are always strings in Figma, but they can be mapped to any type in code. The first parameter is the name of the Variant in Figma, and the second parameter is a value mapping. The keys in this object should match the different options of that Variant in Figma, and the value is whatever you want to output instead.

```tsx
// maps the 'Options' variant in Figma to enum values in code
figma.enum('Options', {
  'Option 1': Option.first,
  'Option 2': Option.second,
})

// maps the 'Options' variant in Figma to sub-component values in code
figma.enum('Options', {
  'Option 1': <Icon />,
  'Option 2': <IconButton />,
})

// result is true for disabled variants otherwise undefined
figma.enum('Variant', { Disabled: true })

// enums mappings can be used to show a component based on a Figma variant
figma.connect(Modal, 'https://...', {
  props: {
    cancelButton: figma.enum('Type', {
      Cancellable: <CancelButton />,
    }),
    // ...
  },
  example: ({ cancelButton }) => {
    return (
      <Modal>
        <Title>Title</Title>
        <Content>Some content</Content>
        {cancelButton}
      </Modal>
    )
  },
})
```

Mapping objects for `figma.enum` as well as `figma.boolean` allow nested references, which is useful if you want to conditionally render a nested instance, for example.

```tsx
// maps the 'Options' variant in Figma to enum values in code
figma.enum('Type', {
  WithIcon: figma.instance('Icon'),
  WithoutIcon: undefined,
})
```

In contrast to `figma.boolean`, values are not normalized for `figma.enum`. You always need to pass the exact literal values to the mapping object.

```tsx
// These two are equivalent for a variant with the options "Yes" and "No"
disabled: figma.enum("Boolean Variant", {
  Yes: // ...
  No: // ...
})
disabled: figma.boolean("Boolean Variant", {
  true: // ...
  false: // ...
})
```

### Instances

"Instances" is Figma's term for nested component references. For example, in the case of a `Button` containing an `Icon` as a nested component, we would call the `Icon` an instance. In Figma, instances can be properties, such as inputs to the component (similar to render props in code). Similarly to how we can map booleans, enums, and strings from Figma to code, we can also map these to instance properties.

To ensure instance properties are as useful as possible with Code Connect, we recommend you implement Code Connect for all common components that you would expect to be used as values for a given property. Dev Mode automatically populates the referenced component's connected code snippet example with the instance code that matches the properties.

Consider the following example:

```tsx
// maps an instance-swap property from Figma
figma.instance('PropName')
```

The return value of `figma.instance` is a JSX component and can be used in your example like a typical JSX component prop would be in your codebase.

```tsx
figma.connect(Button, 'https://...', {
  props: {
    icon: figma.instance('Icon'),
  },
  example: ({ icon }) => {
    return <Button icon={icon}>Instance prop Example</Button>
  },
})
```

You should then have a separate `figma.connect` call that connects the Icon component with the nested Figma component. Make sure to connect the backing component of that instance, not the instance itself.

```tsx
figma.connect(Icon32Add, 'https://...')
```

### Instance children

It's common for components in Figma to have child instances that aren't bound to an instance-swap prop. Similarly to `figma.instance`, we can render the code snippets for these nested instances with `figma.children`. This helper takes the name of the instance layer within the parent component as its parameter, rather than a Figma prop name.

To illustrate this, consider the layer hierarchy in a component vs. an instance of that component:

```
Button (Component)
  Icon (Instance)
```

In the previous example, "Icon" is the original name of the layer and the value you should pass to `figma.children()`.

```
Button (Instance)
  RenamedIcon (Instance)
```

In the previous example, the instance layer was renamed. Renaming the layer won't break the mapping since, in this case, we're not using the layer's name.

> **Note:** The nested instance also must be connected separately.

Layer names may differ between variants in a component set. To ensure the component (Button) can render a nested instance (Icon) for any of those variants, you must either use the wildcard option `figma.children("*")` or ensure that the layer name representing the instance (Icon) is the same across all variants of your component set (Button).

```tsx
// map one child instance with the layer name "Tab"
figma.children('Tab')

// map multiple child instances by their layer names to a single prop
figma.children(['Tab 1', 'Tab 2'])
```

#### Wildcard match

`figma.children()` can be used with a single wildcard '*' character, to partially match names or to render any nested child. Wildcards cannot be used with the array argument. Matches are case sensitive.

```tsx
// map any (all) child instances
figma.children('*')

// map any child instances that starts with "Icon"
figma.children('Icon*')
```

### Nested properties

When you don't want to connect a child component, but instead want to map its properties on the parent level, you can use `figma.nestedProps()`. This helper takes the name of the layer as the first parameter, and a mapping object as the second parameter. These props can then be referenced in the `example` function. `nestedProps` will always select a single instance, and cannot be used to map multiple children.

```tsx
// map the properties of a nested instance named "Button Shape"
figma.connect(Button, "https://...", {
  props: {
    buttonShape: figma.nestedProps('Button Shape', {
      size: figma.enum({ ... }),
    })
  },
  example: ({ buttonShape }) => <Button size={buttonShape.size} />
})
```

A common pattern is to use `nestedProps` to access a conditionally hidden layer. This can be achieved by using `nestedProps` in conjunction with `boolean`, and passing a fallback object in the `false` case.

```tsx
figma.connect(Button, "https://...", {
  props: {
    childProps: figma.boolean("showChild", {
      true: figma.nestedProps('Child', {
        label: figma.string("Label")
      }),
      false: { label: undefined }
    })
  },
  example: ({ childProps }) => <Button label={childProps.label} />
})
```

### Text Content

A common pattern for design systems in Figma is to not use props for texts, but rather rely on instances overriding the text content. `figma.textContent()` allows you to select a child text layer and render its content. It takes a single parameter which is the name of the layer in the original component.

```tsx
figma.connect(Button, "https://...", {
  props: {
    label: figma.textContent("Text Layer")
  },
  example: ({ label }) => <Button>{label}</Button>
})
```

### className

For mapping figma properties to a className string, you can use the `figma.className` helper. It takes an array of strings and returns the concatenated string. Any other helper that returns a string (or undefined) can be used in conjunction with this. Undefined values or empty strings are filtered out of the result.

```tsx
figma.connect("https://...", {
  props: {
    className: figma.className([
      'btn-base',
      figma.enum("Size", { Large: 'btn-large' }),
      figma.boolean("Disabled", { true: 'btn-disabled', false: '' }),
    ])
  },
  example: ({ className }) => <Button className={className} />
})
```

In Dev Mode, this snippet appears as:

```tsx
<Button className="btn-base btn-large btn-disabled" />
```

## Variant restrictions

Sometimes a component in Figma is represented by more than one component in code. For example you may have a single `Button` in your Figma design system with a `type` property to switch between primary, secondary, and danger variants. However, in code this may be represented by three different components, such as `PrimaryButton`, `SecondaryButton` and `DangerButton`.

To model this behaviour with Code Connect, use variant restrictions. Variant restrictions allow you to provide entirely different code samples for variants of a single Figma component. The keys and values used should match the name of the variant (or property) in Figma and it's options respectively.

```tsx
figma.connect(PrimaryButton, 'https://...', {
  variant: { Type: 'Primary' },
  example: () => <PrimaryButton />,
})

figma.connect(SecondaryButton, 'https://...', {
  variant: { Type: 'Secondary' },
  example: () => <SecondaryButton />,
})

figma.connect(DangerButton, 'https://...', {
  variant: { Type: 'Danger' },
  example: () => <DangerButton />,
})
```

This also works for Figma properties that aren't variants, such as boolean props.

```tsx
figma.connect(IconButton, 'https://...', {
  variant: { "Has Icon": true },
  example: () => <IconButton />,
})
```

In some cases, you may also want to map a code component to a combination of variants in Figma.

```tsx
figma.connect(DangerButton, 'https://...', {
  variant: { Type: 'Danger', Disabled: true },
  example: () => <DangerButton />,
})
```

## Connecting Icons

Icons can be configured in many different ways in Figma and code. We recommend using instance-swap props in Figma for icons so you're able to access the nested Code Connect icon using a stable instance-swap prop ID.

> **Important:** Design Systems usually contain plenty of icons. It's possible to automate the generation of Code Connect documents using a script that adds them to a new file. For example, an `icons.figma.tsx` file.

### Icons as JSX elements

If your icons are passed as JSX elements in code, you can use Code Connect in the same way you create components.

```tsx
// icon
figma.connect("my-icon-url", {
  example: () => <IconHeart />
})

// parent
figma.connect("my-button-url", {
  props: {
    icon: figma.instance("InstanceSwapPropName")
  },
  example: ({ icon }) => <Button>{icon}</Button>
})

// renders in Dev Mode
<Button><IconHeart/></Button>
```

### Icons as React Components

If your icons are passed as React components, you can return a React component instead of a JSX element in your icon's Code Connect file.

```tsx
// icon
figma.connect("my-icon-url", {
  example: () => IconHeart
})

// parent
figma.connect("my-button-url", {
  props: {
    Icon: figma.instance<React.FunctionComponent>("InstanceSwapPropName")
  },
  example: ({ Icon }) => <Button Icon={Icon} />
})

// renders in Dev Mode
<Button Icon={IconHeart} />
```

### Icons as strings

It's common to use IDs instead of passing around components for icons. In this case, you'll want your icon Code Connect files to just return that string. `figma.instance` takes a `type` parameter that's used to match what the nested template returns.

```tsx
// icon
figma.connect("my-icon-url", {
  example: () => "icon-heart"
})

// parent
figma.connect("my-button-url", {
  props: {
    iconId: figma.instance<string>("InstanceSwapPropName")
  },
  example: ({ iconId }) => <Button iconId={iconId} />
})

// renders in Dev Mode
<Button iconId="icon-heart" />
```

### Accessing icon props in parent component

If you have different ways of rendering icons depending on parent, or, if you want to use icon strings but still be able to map properties of the icon components, you'll want to use `getProps` or `render` which are exposed on the return value of `figma.instance()`. The `example` function of the icon itself determines how that icon renders when clicked in Figma, but can be "overriden" via these additional helpers.

`getProps` gives access to the props of the child (e.g. the icon) from the parent, so you can use those props in your parent component. Note the static prop `iconId: "my-icon"` - any custom/static props like this one will be included in the object returned from `getProps`.

```tsx
// icon
figma.connect("my-icon-url", {
  props: {
    iconId: "my-icon",
    size: figma.enum("Size", {
      'large': 'large',
      'small': 'small'
    })
  },
  example: ({ size }) => <MyIcon size={size}/>
})

// parent
figma.connect("icon-button-url", {
  props: {
    iconProps: figma.instance("InstanceSwapPropName").getProps<{iconId: string, size: "small" | "large"}>()
  },
  example: ({ iconProps }) => <IconButton iconId={iconProps.iconId} iconSize={iconProps.size} />
})

// renders in Dev Mode
<IconButton iconId="my-icon" size="small" />
```

`render` allows you to conditionally render nested connected components. The argument is passed the resolved props of the nested component. This is useful if you need to dynamically render different JSX elements based on a boolean prop, for example.

```tsx
// icon
figma.connect("my-icon-url", {
  props: {
    iconId: "my-icon",
    size: figma.enum("Size", {
      'large': 'large',
      'small': 'small'
    })
  },
  example: ({ size }) => <MyIcon size={size}/>
})

// parent
figma.connect("icon-button-url", {
  props: {
    icon: figma.boolean("Show icon", {
      true: figma.instance("InstanceSwapPropName").render<{iconId: string, size: "small" | "large"}>(props => <ButtonIcon id={props.iconId} size={props.size}/>),
    })
  },
  example: ({ icon }) => <Button icon={icon}/>
})

// renders in Dev Mode
<Button icon={<ButtonIcon id="my-icon" size="small" />} />
```
