# Release Process

**To Coding agents**: only make releases when explicitly told to by the user.

## Quick Reference

```bash
# 1. Edit CHANGELOG.md and package.json with new version

# 2. (Optional) Pre-flight check - run E2E locally to catch issues early:
pnpm test:e2e:chakra  # ~5min
pnpm test:e2e:zapui   # ~2min

# 3. Commit and push tag (triggers CI + E2E):
git add -A && git commit -m "Release v0.X.Y"
git tag v0.X.Y
git push origin main --tags

# 4. Wait for CI + E2E to pass:
echo "⏳ Waiting for CI (unit tests: 3 OS) and E2E (chakra, zapui) to complete..."
gh run watch --exit-status || (gh run view --log | grep -E "FAIL|ERROR|✕" | tail -20)

# 5. Create GitHub release (triggers npm publish):
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

### 3. (Optional) Pre-flight check

Before pushing the tag, optionally run E2E tests locally to catch issues early:

```bash
pnpm test:e2e:chakra  # Takes ~5 minutes
pnpm test:e2e:zapui   # Takes ~2 minutes
```

**Note:** If E2E fails, check whether it's a pre-existing fixture issue or a new regression from your changes. The fixtures (chakra-ui, zapui) may have data quality issues unrelated to your code.

### 4. Push (triggers CI + E2E tests)

```bash
git push origin main --tags
```

This triggers:
- **CI workflow** - unit tests on Ubuntu, Windows, macOS
- **E2E workflow** - integration tests with chakra-ui and zapui fixtures

### 5. Wait for tests

```bash
echo "⏳ Waiting for CI (unit tests: 3 OS) and E2E (chakra, zapui) to complete..."
gh run watch --exit-status
```

This watches the most recent workflow run and exits with code 0 on success, non-zero on failure.

**If tests fail**, get an error summary:
```bash
gh run view --log | grep -E "FAIL|ERROR|✕" | tail -20
```

Then fix the issue and retry from step 2 (you'll need to delete and recreate the tag).

**To retry after failure:**
```bash
git tag -d v0.2.7                    # Delete local tag
git push origin :refs/tags/v0.2.7    # Delete remote tag
git reset --hard HEAD~1              # Undo release commit
git push --force origin main         # Force push
# ... make fixes, commit ...
git tag v0.2.7                       # Recreate tag
git push origin main --tags          # Push again
```

### 6. Create GitHub release (publishes to npm)

Only after E2E passes:

```bash
gh release create v0.2.7 \
  --title "v0.2.7 - Brief description" \
  --notes "## Fixed
- Description of fix"
```

This triggers GitHub Actions to publish to npm.

### 7. Verify

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
