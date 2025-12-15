# Connecting Web components

This guide helps you connect your HTML components to Figma components using Code Connect. This lets you document Web Components, Angular, Vue, and any other framework that uses HTML syntax. See the examples section for examples of using Code Connect with various HTML-based frameworks.

> **Important:** Code Connect files are not executed. While they're written using real components from your codebase, the Figma CLI essentially treats code snippets as strings. This means you can, for example, use hooks without needing to mock data.
>
> However, this also means that logical operators such as ternaries or conditionals will be output verbatim in your example code rather than executed to show the result. You aren't able to dynamically construct `figma.connect` calls in a for-loop, as another example.

## Dynamic code snippets

If you completed Getting Started with Code Connect, you should have a connected code snippet visible in Dev Mode when inspecting instances of that component. However, the code snippet doesn't yet reflect the entirety of the design.

To ensure the connected code snippet accurately reflects the design, you need to make use of property mappings. This enables you to link specific props in the design to props in code. In most cases, design and code props don't match 1:1, so it's necessary for us to configure this to ensure the correct code is shown in Dev Mode.

Here is a simple example for a button with a `label`, `disabled`, and `type` property.

```typescript
import figma, { html } from '@figma/code-connect/html'

figma.connect('https://...', {
  props: {
    label: figma.string('Text Content'),
    disabled: figma.boolean('Disabled'),
    type: figma.enum('Type', {
      Primary: 'primary',
      Secondary: 'secondary',
    }),
  },
  example: ({ disabled, label, type }) => html`
<ds-button disabled=${disabled} type=${type}>
  ${label}
</ds-button>`
})
```

Figma properties can be inserted in the Code Connect example using template string interpolation, e.g. `${disabled}`. For HTML element attributes, Code Connect uses the type of the Figma property to render it correctly, so `disabled=${disabled}` will either render `disabled` or nothing, as it is a boolean; whereas `type=${type}` will render `type="primary"`, as it is a string.

## The `figma` import

The `figma` import contains helpers for mapping all sorts of properties from design to code. They work for simple mappings where only the naming differs between Figma and code, as well as more complex mappings where the type differs. See the below reference for all the helpers that exist and the ways you can use them to connect Figma and code components using Code Connect.

### Strings

Strings are the simplest value to map from Figma to code. Simply call `figma.string` with the Figma prop name you want to reference as a parameter. This is useful for things like button labels, header titles, tooltips.

```typescript
figma.string('Title')
```

### Booleans

Booleans work similar to strings. However, Code Connect also provides helpers for mapping booleans in Figma to more complex types in code. For example you may want to map a Figma boolean to the existence of a specific sublayer in code. In addition to mapping boolean props, `figma.boolean` can be used to map boolean Variants in Figma. A boolean Variant is a Variant with only two options that are either "Yes"/"No", "True"/"False" or "On"/Off". For `figma.boolean` these values are normalized to `true` and `false`.

```typescript
// simple mapping of boolean from figma to code
figma.boolean('Has Icon')

// map a boolean value to one of two options of any type
figma.boolean('Has Icon', {
  true: html`<ds-icon></ds-icon>`,
  false: html`<ds-spacer></ds-spacer>`,
})
```

In some cases, you only want to render a certain prop if it matches some value in Figma. You can do this either by passing a partial mapping object, or setting the value to `undefined`.

```typescript
// Don't render the prop if 'Has label' in figma is `false`
figma.boolean('Has label', {
  true: figma.string('Label'),
  false: undefined,
})
```

### Enums

Variants (or enums) in Figma are commonly used to control the look and feel of components that require more complex options than a simple boolean toggle. Variant properties are always strings in Figma, but they can be mapped to any type in code. The first parameter is the name of the Variant in Figma, and the second parameter is a value mapping. The keys in this object should match the different options of that Variant in Figma, and the value is whatever you want to output instead.

```typescript
// maps the 'Options' variant in Figma to enum values in code
figma.enum('Options', {
  'Option 1': Option.first,
  'Option 2': Option.second,
})

// maps the 'Options' variant in Figma to sub-component values in code
figma.enum('Options', {
  'Option 1': html`<ds-icon></ds-icon>`,
  'Option 2': html`<ds-icon-button></ds-icon-button>`,
})

// result is true for disabled variants otherwise undefined
figma.enum('Variant', { Disabled: true })

// enums mappings can be used to show a component based on a Figma variant
figma.connect('https://...', {
  props: {
    cancelButton: figma.enum('Type', {
      Cancellable: html`<ds-cancel-button></ds-cancel-button>`
    }),
    // ...
  },
  example: ({ cancelButton }) => html`
<ds-modal>
  <ds-modal-title>Title</ds-modal-title>
  <ds-modal-content>Some content</ds-modal-content>
  ${cancelButton}
</ds-modal>`
  },
})
```

Mapping objects for `figma.enum` as well as `figma.boolean` allow nested references, which is useful if you want to conditionally render a nested instance, for example.

```typescript
// maps the 'Options' variant in Figma to enum values in code
figma.enum('Type', {
  WithIcon: figma.instance('Icon'),
  WithoutIcon: undefined,
})
```

In contrast to `figma.boolean`, values are not normalized for `figma.enum`. You always need to pass the exact literal values to the mapping object.

```typescript
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

```typescript
// maps an instance-swap property from Figma
figma.instance('PropName')
```

The return value of `figma.instance` is an `html`-tagged template literal and can be used in your example as a child element.

```typescript
figma.connect('https://...', {
  props: {
    icon: figma.instance('Icon'),
  },
  example: ({ icon }) => html`<ds-button><div slot="icon">${icon}</div> Instance prop Example</ds-button>`
})
```

You should then have a separate `figma.connect` call that connects the Icon component with the nested Figma component. Make sure to connect the backing component of that instance, not the instance itself.

```typescript
figma.connect('https://...', {
  example: () => html`<ds-icon icon="add"></ds-icon>`
})
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

```typescript
// map one child instance with the layer name "Tab"
figma.children('Tab')

// map multiple child instances by their layer names to a single prop
figma.children(['Tab 1', 'Tab 2'])
```

### Wildcard match

`figma.children()` can be used with a single wildcard '*' character, to partially match names or to render any nested child. Wildcards cannot be used with the array argument. Matches are case sensitive.

```typescript
// map any (all) child instances
figma.children('*')

// map any child instances that starts with "Icon"
figma.children('Icon*')
```

### Nested properties

When you don't want to connect a child component, but instead want to map its properties on the parent level, you can use `figma.nestedProps()`. This helper takes the name of the layer as the first parameter, and a mapping object as the second parameter. These props can then be referenced in the `example` function. `nestedProps` will always select a single instance, and cannot be used to map multiple children.

```typescript
// map the properties of a nested instance named "Button Shape"
figma.connect("https://...", {
  props: {
    buttonShape: figma.nestedProps('Button Shape', {
      size: figma.enum({ ... }),
    })
  },
  example: ({ buttonShape }) => html`<ds-button size=${buttonShape.size}></ds-button>`
})
```

### Text Content

A common pattern for design systems in Figma is to not use props for texts, but rather rely on instances overriding the text content. `figma.textContent()` allows you to select a child text layer and render its content. It takes a single parameter which is the name of the layer in the original component.

```typescript
figma.connect("https://...", {
  props: {
    label: figma.textContent("Text Layer")
  },
  example: ({ label }) => html`<ds-button>${label}</ds-button>`
})
```

### className

For mapping figma properties to a className string, you can use the `figma.className` helper. It takes an array of strings and returns the concatenated string. Any other helper that returns a string (or undefined) can be used in conjunction with this. Undefined values or empty strings are filtered out of the result.

```typescript
figma.connect("https://...", {
  props: {
    className: figma.className([
      'btn-base',
      figma.enum("Size", { Large: 'btn-large' }),
      figma.boolean("Disabled", { true: 'btn-disabled', false: '' }),
    ])
  },
  example: ({ className }) => html`<button class=${className}></button>`
})
```

In Dev Mode, this snippet appears as:

```html
<button class="btn-base btn-large btn-disabled"></button>
```

## Variant restrictions

Sometimes a component in Figma is represented by more than one component in code. For example you may have a single `Button` in your Figma design system with a `type` property to switch between primary, secondary, and danger variants. However, in code this may be represented by three different components, a `<ds-button-primary>`, `<ds-button-secondary>` and `<ds-button-danger>`.

To model this behaviour with Code Connect, use variant restrictions. Variant restrictions allow you to provide entirely different code samples for different variants of a single Figma component. The keys and values used should match the name of the variant (or property) in Figma and it's options respectively.

```typescript
figma.connect('https://...', {
  variant: { Type: 'Primary' },
  example: () => html`<ds-button-primary></ds-button-primary>`,
})

figma.connect('https://...', {
  variant: { Type: 'Secondary' },
  example: () => html`<ds-button-secondary></ds-button-secondary>`,
})

figma.connect('https://...', {
  variant: { Type: 'Danger' },
  example: () => html`<ds-button-danger></ds-button-danger>`,
})
```

This also works for Figma properties that aren't variants, such as boolean props.

```typescript
figma.connect('https://...', {
  variant: { "Has Icon": true },
  example: () => html`<ds-icon-button></ds-icon-button>`,
})
```

In some cases, you may also want to map a code component to a combination of variants in Figma.

```typescript
figma.connect('https://...', {
  variant: { Type: 'Danger', Disabled: true },
  example: () => html`<ds-button-danger></ds-button-danger>`,
})
```

## Examples

Code Connect HTML supports any valid HTML markup, and so in addition to documenting plain HTML and Web Components, can also be used for documenting HTML-based frameworks such as Angular and Vue. Any JavaScript/TypeScript code accompanying the HTML code must be enclosed in a `<script>` tag.

Angular and Vue projects will be auto-detected based on their presence in `package.json`, and the default label for your examples will be set appropriately.

### Web Components example

```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('https://...', {
  props: {
    text: figma.string('Text'),
    disabled: figma.boolean('Disabled'),
    size: figma.enum('Size', {
      'small': 'sm',
      'large': 'lg'
    })
  },
  example: (props) =>
      html`
<ds-button
  disabled=${props.disabled}
  size=${props.size}
>
  ${props.text}
</ds-button>

<script>
  document.querySelector('ds-button')
    .addEventListener('click', () => {
      alert("You clicked ${props.text}");
    })
</script>`,
    imports: ['<script type="module" src="https://my.domain/js/ds-button.min.js">'],
  }
)
```

### Angular example

```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('https://...', {
  props: {
    text: figma.string('Text'),
    disabled: figma.boolean('Disabled'),
    size: figma.enum('Size', {
      'small': 'sm',
      'large': 'lg'
    })
  },
  example: (props) =>
      html`
<button
  dsButton
  disabled=${props.disabled}
  size=${props.size}
  (onClick)="onClick($event)"
>
  ${props.text}
</button>

<script>
  export class Example {
    public onClick() {
      alert("You clicked ${props.text}");
    }
  }
</script>`,
    imports: ["import { DsButton } from '@ds-angular/button'"],
  }
)
```

### Vue example

```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('https://...', {
  props: {
    text: figma.string('Text'),
    disabled: figma.boolean('Disabled'),
    size: figma.enum('Size', {
      'small': 'sm',
      'large': 'lg'
    })
  },
  example: (props) =>
      html`
<script setup>
  function onClick() {
    alert('You clicked ${props.text}');
  }
</script>

<ds-button
  disabled=${props.disabled}
  size=${props.size}
  @click="onClick"
>
  ${props.text}
</ds-button>`,
    imports: ["import { DsButton } from '@ds-vue/button'"],
  }
)
```

### Lit example

As the example code is written in a template string, you need to escape any `$` symbols which you want to render verbatim in your example, otherwise they'll be interpreted as placeholders.

```typescript
import figma, { html } from '@figma/code-connect/html';

figma.connect('https://...', {
  props: {
    text: figma.string('Text'),
    disabled: figma.boolean('Disabled')
  },
  example: (props) =>
      html`
<ds-button
  disabled=${props.disabled}
  size=${props.size}
  ?litSyntaxExample=\${booleanVar}
>
  ${props.text}
</ds-button>`,
    imports: ["import '@ds-lit/button'"],
  }
)
```

## Connecting Icons

Icons can be configured in many different ways in Figma and code. We recommend using instance-swap props in Figma for icons so you're able to access the nested Code Connect icon using a stable instance-swap prop ID.

> **Important:** Design Systems usually contain plenty of icons. It's possible to automate the generation of Code Connect documents using a script that adds them to a new file. For example, an `icons.figma.ts` file.

### Icons as strings

It's common to use IDs instead of passing around components for icons. In this case, you'll want your icon Code Connect files to just return that string. `figma.instance` takes a `type` parameter that's used to match what the nested template returns. You can then have a generic icon component that consumes the icon ID of the inner instance.

```typescript
// Icon ID
figma.connect("my-icon-url", {
  example: () => "icon-heart"
})

// Icon component
figma.connect("my-icon-component-url", {
  props: {
    iconId: figma.instance<string>("InstanceSwapPropName")
  },
  example: ({ iconId }) => html`<ds-icon iconId=${iconId} />`
})

// renders in Dev Mode
<ds-icon iconId="icon-heart" />
```

Or, as in another common use case, consume the ID directly in other design system components, such as a button.

```typescript
// Icon ID
figma.connect("my-icon-url", {
  example: () => "icon-heart"
})

// Button component
figma.connect("my-button-url", {
  props: {
    iconId: figma.instance<string>("InstanceSwapPropName")
  },
  example: ({ iconId }) => html`<ds-button iconId=${iconId} />`
})

// renders in Dev Mode
<ds-button iconId="icon-heart" />
```
