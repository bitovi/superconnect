# figma.config.json spec

## Purpose
Provide a fuller config than the minimal include/parser settings

## Baseline example (Angular)
```
{
  "schemaVersion": 1,
  "codeConnect": {
    "parser": "html",
    "label": "angular",
    "include": [
      "codeConnect/**/*.figma.ts",
      "packages/**/*.{ts,tsx}",
      "apps/**/*.{ts,tsx}"
    ],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**"
    ]
  }
}
```

## Baseline example (React)
```
{
  "schemaVersion": 1,
  "codeConnect": {
    "parser": "react",
    "label": "react",
    "include": [
      "codeConnect/**/*.figma.tsx",
      "packages/**/*.{ts,tsx}",
      "apps/**/*.{ts,tsx}"
    ],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**"
    ]
  }
}
```

## Optional fields
- interactiveSetupFigmaFileUrl: "https://www.figma.com/design/<fileKey>"
- documentUrlSubstitutions: map of FIGMA_* tokens to node URLs
- paths: package path aliases for monorepos

## Notes
- Keep include globs broad enough for the CLI to resolve imports
- Keep exclude globs to avoid parsing build artifacts
