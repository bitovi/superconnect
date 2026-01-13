# Release Process

**To Coding agents**: only make releases when explicitly told to by the user.

## Quick Reference

```bash
# 1. Edit CHANGELOG.md and package.json with new version

# 2. Test locally:
pnpm test              # Unit tests (~3s)
pnpm test:e2e chakra   # E2E (~5min, optional but recommended)
pnpm test:e2e zapui    # E2E (~2min, optional)

# 3. Commit, tag, push:
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags

# 4. Wait for CI:
gh run watch --exit-status

# 5. Create GitHub release (triggers npm publish):
gh release create vX.Y.Z --title "vX.Y.Z - Brief description" --notes "Paste CHANGELOG section"

# 6. Verify:
npm view @bitovi/superconnect@X.Y.Z
```

## Detailed Steps

### 1. Update version files

**package.json** — bump `"version": "X.Y.Z"`

**CHANGELOG.md** — move items from `[Unreleased]` to new version heading:
```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD
### Changed
- Description
```

### 2. Test locally

```bash
pnpm test              # Unit tests (required)
pnpm test:e2e chakra   # E2E (~5min, recommended)
pnpm test:e2e zapui    # E2E (~2min, optional)
```

### 3. Commit, tag, push

```bash
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

Pushing triggers CI (unit tests on 3 OSes) and E2E workflows.

### 4. Wait for CI

```bash
gh run watch --exit-status
```

If tests fail:
```bash
gh run view --log | grep -E "FAIL|ERROR|✕" | tail -20  # See errors
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z  # Delete tag
git reset --hard HEAD~1 && git push --force             # Undo commit
# Fix, then restart from step 3
```

### 5. Create GitHub release

```bash
gh release create vX.Y.Z --title "vX.Y.Z - Brief description" --notes "Paste CHANGELOG"
```

This triggers npm publish via GitHub Actions.

### 6. Verify

```bash
npm view @bitovi/superconnect@X.Y.Z
```

## Versioning

[Semantic Versioning](https://semver.org/): **patch** = bug fixes, **minor** = new features, **major** = breaking changes.

## Prerequisites

- Push access to repo
- `gh` CLI authenticated (`gh auth login`)
- `NPM_TOKEN` in GitHub Actions secrets

## One-time Setup: NPM_TOKEN

1. Create at https://www.npmjs.com/settings/YOUR_USERNAME/tokens (Granular, read/write for `@bitovi/superconnect`)
2. Add to https://github.com/bitovi/superconnect/settings/secrets/actions as `NPM_TOKEN`

## Troubleshooting

| Error | Fix |
|-------|-----|
| Package already published | Bump version and retry |
| Tests failing in CI | Fix locally first |
| npm token expired | Update `NPM_TOKEN` secret |
