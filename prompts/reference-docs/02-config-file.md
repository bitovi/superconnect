# Configuring your project

**Source:** https://developers.figma.com/docs/code-connect/api/config-file/

Code Connect can be configured with a `figma.config.json` file, which must be located in your project root (e.g. alongside the `package.json` or `.xcodeproj` file).

Every platform supports some common configuration options, in addition to any platform-specific options.

## Common configuration options

### `include` and `exclude`

`include` and `exclude` are lists of globs for where to parse Code Connect files, and for where to search for your component code when using the interactive setup. `include` and `exclude` paths must be relative to the location of the config file.

```json
{
  "codeConnect": {
    "include": [],
    "exclude": ["test/**", "docs/**", "build/**"]
  }
}
```

### `parser`

Code Connect tries to determine your project type by looking at the root of your project directory:

- If a `package.json` containing `react` is found, your project is detected as React
- If a `package.json` is found and doesn't contain `react`, your project is detected as HTML
- If a file matching `Package.swift` or `*.xcodeproj` is found, your project is detected as Swift
- If a file matching `build.gradle.kts` is found, your project is detected as Jetpack Compose

If your project framework isn't detected correctly, you can override the project type by using the `parser` key in your `figma.config.json` file. Valid values are `react`, `html`, `swift` and `compose`.

```json
{
  "codeConnect": {
    "parser": "react"
  }
}
```

### `label`

`label` lets you specify the label that appears in Figma for your Code Connect snippets. The label defaults to your project type, such as `React`. Setting a different label for the snippets in Dev Mode can be useful, such as for showing different versions of the code.

For HTML projects, Code Connect sets the default label based on HTML-based frameworks detected in the first ancestor `package.json` of the working directory which matches one of the following:

- If a `package.json` containing `angular` is found, the label is set to `Angular`
- If a `package.json` containing `vue` is found, the label is set to `Vue`
- Otherwise, the label is set to `Web Components`

### `documentUrlSubstitutions`

`documentUrlSubstitutions` allows you to specify a set of substitutions that are run on the `figmaNode` URLs when parsing or publishing documents.

This lets you use multiple `figma.config.json` files to publish Code Connect snippets for different Figma files without having to modify every Code Connect file. For example, you could use substitutions to set up a testing version of your Code Connect components.

Substitutions are specified as an object, where the key is the string to be replaced, and the value is the string to replace that with.

Consider this example:

```json
{
  "codeConnect": {
    "documentUrlSubstitutions": {
      "https://figma.com/design/1234abcd/File-1": "https://figma.com/design/5678dcba/File-2"
    }
  }
}
```

The substitution in the previous example changes Figma node URLs like `https://figma.com/design/1234abcd/File-1/?node-id=12:345` to `https://figma.com/design/5678dbca/File-2/?node-id=12:345`.

## React-specific project configuration

```json
{
  "codeConnect": {
    "parser": "react",
    "include": [],
    "exclude": ["test/**", "docs/**", "build/**"],
    "importPaths": {
      "src/components/*": "@ui/components"
    },
    "paths": {
      "@ui/components/*": ["src/components/*"]
    }
  }
}
```

### `importPaths`

`importPaths` lets you override the relative paths that are used to import code components in your Code Connect files. Specifying an import path is useful when you want users of your design system to import components from a specific package, rather than from a directory relative to your Code Connect files. The paths must be local.

Paths are specified in the `importPaths` object, where the key is the path you want to match and override, and the value is the path to use instead.

For example, assume you have a code component, `Button.tsx` in `./src/components/` (relative to your project root). In the same directory is a corresponding Code Connect file, `Button.figma.tsx`, which looks like this:

```typescript
import { Button } from './'
figma.connect(Button, 'https://...')
```

For the `Button` import, you want to override the relative path (`./`) and specify a different path to import from. In your `figma.config.json` file, you add the following:

```json
{
  "codeConnect": {
    "importPaths": {
      "src/components/*": "@ui/components"
    }
  }
}
```

In `importPaths`, the `src/components/*` key uses the `*` wildcard to include all code components in that directory along with `Button.tsx`. The value is set to `@ui/components`. The next time you use the Code Connect CLI to manage your files, the Code Connect file for `Button` is updated:

```typescript
import { Button } from '@ui/components'
```

### `paths`

If you're using path aliases in your TypeScript project configuration, you must set `paths` in `figma.config.json` so Code Connect knows how to resolve your imports. The `paths` object in your Code Connect config file should match the `paths` object used in your project's tsconfig.json.

### `imports`

You can override the generated import statements for a connected component by passing an array of `imports`. This might be useful if the automatic resolution does not work well for your use case.

```typescript
figma.connect(Button, "https://...", {
  imports: ["import { Button } from '@lib'"]
})
```
