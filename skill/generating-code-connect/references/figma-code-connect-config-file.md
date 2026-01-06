---
source_url: https://developers.figma.com/docs/code-connect/api/config-file/
notes: Condensed reference for figma.config.json fields used by this skill. Authoritative source is the URL above
---

# figma.config.json reference

## Purpose
Configure what files Code Connect parses, how it parses them, and how snippets appear in Dev Mode

## Schema wrapper
This skill writes a config shaped like:
```json
{
  "schemaVersion": 1,
  "codeConnect": {
    "parser": "html",
    "label": "angular",
    "include": [],
    "exclude": []
  }
}
```

## include and exclude
- `include` and `exclude` are lists of glob patterns
- Paths must be relative to the location of `figma.config.json`
- Use broad include globs so imports can be resolved, but exclude build artifacts and dependencies

Recommended excludes:
- `**/node_modules/**`
- `**/dist/**`
- `**/.next/**`

## parser
Select the parser for your project
- React: `react` for `.figma.tsx`
- Angular and HTML-based frameworks: `html` for `.figma.ts`

## label
`label` controls the snippet label shown in Figma Dev Mode
- Defaults are framework-derived, but setting an explicit label is fine

## interactiveSetupFigmaFileUrl
Even though this skill does not use interactive setup, `interactiveSetupFigmaFileUrl` can still be useful metadata:
```json
{
  "codeConnect": {
    "interactiveSetupFigmaFileUrl": "https://www.figma.com/design/<FILE_KEY>/<NAME>"
  }
}
```

## documentUrlSubstitutions
Use `documentUrlSubstitutions` to substitute placeholder tokens in Code Connect files with real node URLs at publish time
- Useful when publishing the same repo against multiple Figma documents or versions

## paths and imports
If your repo uses path aliases (monorepos or TS path mapping), configure `paths` so Code Connect can resolve imports

## Minimal vs full config
Minimal configs can work, but tend to fail import resolution in real repos
- Prefer include globs that cover the generated Code Connect files and the code they import
