---
source_url: https://developers.figma.com/docs/code-connect/common-issues/
notes: Condensed troubleshooting reference. Authoritative source is the URL above
---

# Common issues

## Connectivity issues due to proxies or network security software
Symptoms:
- Requests to Figma fail or time out
- Publish and parse cannot reach Figma servers

Suggested actions:
- Ensure connections to `https://api.figma.com/` are allowed by proxy or network security tools
- If running in CI or a restricted environment, confirm outbound HTTPS access to `api.figma.com`

## 413 errors due to too large uploads
Symptoms:
- `figma connect publish` fails with HTTP 413

Suggested actions:
- Re-run publish with batching, starting at 50 and decreasing until it succeeds:
  - `figma connect publish --batch-size 50`

## Notes for this skill
- Prefer validating locally before publishing
- If validation passes but publish fails, treat it as an environment or transport issue, not a mapping issue
