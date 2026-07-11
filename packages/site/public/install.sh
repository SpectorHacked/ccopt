#!/bin/sh
# Effigent installer — installs the `effigent` CLI from npm (needs Node.js 20+).
# Served publicly from https://effigent.ai/install.sh (the source repo stays private).
#
#   curl -fsSL https://effigent.ai/install.sh | sh
#   curl -fsSL https://effigent.ai/install.sh | sh -s -- --join <token>
#
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required (>= 20). Install it from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node.js >= 20 required, found $(node --version)" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required (it ships with Node.js)." >&2
  exit 1
fi

echo "Installing the effigent CLI from npm…"
npm install -g effigent

# One-shot workspace onboarding:  ... | sh -s -- --join <token>
# The token (from `effigent invite`) embeds the server URL + key, so join is self-contained.
if [ "${1:-}" = "--join" ] && [ -n "${2:-}" ]; then
  effigent join "$2"
else
  effigent --version >/dev/null 2>&1 && echo "Installed. Verify your setup with: effigent doctor"
fi
