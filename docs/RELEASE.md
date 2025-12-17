# Release Process

## Quick Reference

```bash
# 1. Edit CHANGELOG.md and package.json with new version
# 2. Commit, tag, push, release:
git add -A && git commit -m "Release v0.X.Y"
git tag v0.X.Y
git push origin main --tags
gh release create v0.X.Y --title "v0.X.Y - Brief description" --notes "Paste CHANGELOG section"
```

## Full Workflow

### 1. Update version files

Edit both files with the new version number:

**package.json:**
```json
"version": "0.2.7"
```

**CHANGELOG.md:**
```markdown
## [Unreleased]

## [0.2.7] - 2025-12-17

### Fixed
- Description of what was fixed
```

### 2. Commit and tag

```bash
git add -A
git commit -m "Release v0.2.7"
git tag v0.2.7
```

### 3. Push

```bash
git push origin main --tags
```

### 4. Create GitHub release

```bash
gh release create v0.2.7 \
  --title "v0.2.7 - Brief description" \
  --notes "## Fixed
- Description of fix"
```

This triggers GitHub Actions to run tests and publish to npm.

### 5. Verify

```bash
npm view @bitovi/superconnect@0.2.7
```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.2.6 → 0.2.7): Bug fixes, no API changes
- **Minor** (0.2.7 → 0.3.0): New features, backwards compatible
- **Major** (0.3.0 → 1.0.0): Breaking changes

## Prerequisites

- Push access to the repo
- `gh` CLI authenticated (`gh auth login`)
- `NPM_TOKEN` secret configured in GitHub Actions (see below)

## Setup (One-time)

### NPM_TOKEN for GitHub Actions

1. Create token at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Type: Granular Access Token
   - Packages: `@bitovi/superconnect` with read/write
2. Add to repo secrets: https://github.com/bitovi/superconnect/settings/secrets/actions
   - Name: `NPM_TOKEN`

## Troubleshooting

**"Package already published"** — Can't republish same version. Bump and try again.

**"Tests failing in CI"** — Fix tests locally before releasing.

**"npm token expired"** — Update `NPM_TOKEN` in GitHub secrets.
