#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-.}"
local_cli="$repo_root/node_modules/@figma/code-connect/bin/figma"

if [ -x "$local_cli" ]; then
  echo "Found local Figma CLI at $local_cli"
  exit 0
fi

if command -v figma >/dev/null 2>&1; then
  echo "Found Figma CLI on PATH: $(command -v figma)"
  exit 0
fi

cat <<'MESSAGE'
Figma Code Connect CLI not found
Install it locally in the repo, then re-run validation
Example:
  pnpm add -D @figma/code-connect
  npm install -D @figma/code-connect
MESSAGE

exit 1
