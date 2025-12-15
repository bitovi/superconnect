# Release Process

This document describes the automated release process for `@bitovi/superconnect`.

## Prerequisites

- You must be a member of the Bitovi npm org with publish rights
- The `NPM_TOKEN` secret must be configured in GitHub Actions (see Setup below)

## Release Workflow

### 1. Update version and CHANGELOG

```bash
# Bump version (patch, minor, or major)
npm version patch -m "Release v%s"

# This will:
# - Update package.json version
# - Create a git commit
# - Create a git tag (e.g., v0.1.1)
```

### 2. Update CHANGELOG.md

Edit `CHANGELOG.md` to document the changes:

```markdown
## [0.1.1] - 2025-12-15

### Fixed
- Fix repository URLs in package.json

[0.1.1]: https://github.com/bitovi/superconnect/releases/tag/v0.1.1
```

Commit the CHANGELOG:

```bash
git add CHANGELOG.md
git commit --amend --no-edit
```

### 3. Push with tags

```bash
# Push code and tags together
git push origin main --follow-tags
```

### 4. Create GitHub Release

Go to: https://github.com/bitovi/superconnect/releases/new

- Select the tag (e.g., `v0.1.1`)
- Set title: `v0.1.1 - Brief Description`
- Copy relevant section from CHANGELOG.md
- Click **Publish release**

**Automated publishing kicks in:**
- GitHub Actions runs tests
- If tests pass, publishes to npm with provenance
- Package appears on npmjs.com within minutes

### 5. Verify

```bash
# Check it's published
npm view @bitovi/superconnect

# Test installation
npm install -g @bitovi/superconnect@latest
superconnect --help
```

## Versioning Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.1.0 → 0.1.1): Bug fixes, documentation updates, no API changes
- **Minor** (0.1.0 → 0.2.0): New features, backwards compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes, API changes

```bash
npm version patch  # Bug fixes
npm version minor  # New features
npm version major  # Breaking changes
```

## Setup (One-time)

### Configure NPM_TOKEN

1. Create a **Granular Access Token** at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Token name: `superconnect-github-actions`
   - Expiration: 1 year (or your preference)
   - Packages: `@bitovi/superconnect` with **Read and write** permission
   - No IP allowlist needed
2. Go to GitHub repo settings: https://github.com/bitovi/superconnect/settings/secrets/actions
3. Update `NPM_TOKEN` secret with your token
4. Test by creating a release (v0.1.1 or higher)

### Verify Permissions

```bash
# Check you're logged in
npm whoami

# Verify org membership
npm org ls bitovi
```

## Troubleshooting

**"Package already published"**
- Can't republish same version
- Bump version with `npm version patch`

**"Access token expired"**
- Update NPM_TOKEN in GitHub secrets
- Use an Automation token from npmjs.com

**"Not authorized"**
- Verify you're in Bitovi org with developer+ role
- Contact org admin for permissions

**Tests failing in CI**
- Fix tests locally first
- Push fixes before creating release
