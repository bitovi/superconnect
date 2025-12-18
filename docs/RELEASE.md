# Release Process

**To Coding agents**: only make releases when explicitly told to by the user.

## Quick Reference

```bash
# 1. Edit CHANGELOG.md and package.json with new version
# 2. Commit and push tag (triggers E2E tests):
git add -A && git commit -m "Release v0.X.Y"
git tag v0.X.Y
git push origin main --tags

# 3. Wait for E2E tests to pass:
gh run watch --exit-status  # Watches most recent run, exits non-zero on failure

# 4. Create GitHub release (triggers npm publish):
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

### 3. Push (triggers E2E tests)

```bash
git push origin main --tags
```

This triggers:
- **CI workflow** - unit tests on Ubuntu, Windows, macOS
- **E2E workflow** - integration tests with chakra-ui and zapui fixtures

### 4. Wait for E2E tests

```bash
gh run watch --exit-status
```

This watches the most recent workflow run and exits with code 0 on success, non-zero on failure. If it fails, fix the issue and retry from step 2 (you'll need to delete and recreate the tag).

**To retry after failure:**
```bash
git tag -d v0.2.7                    # Delete local tag
git push origin :refs/tags/v0.2.7    # Delete remote tag
# ... make fixes, commit ...
git tag v0.2.7                       # Recreate tag
git push origin main --tags          # Push again
```

### 5. Create GitHub release (publishes to npm)

Only after E2E passes:

```bash
gh release create v0.2.7 \
  --title "v0.2.7 - Brief description" \
  --notes "## Fixed
- Description of fix"
```

This triggers GitHub Actions to publish to npm.

### 6. Verify

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
