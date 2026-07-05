#!/bin/sh
# ccopt installer — single-file CLI, no dependencies beyond Node 20+.
#
#   curl -fsSL https://raw.githubusercontent.com/SpectorHacked/ccopt/main/install.sh | sh
#
# or from a local checkout:   ./install.sh
set -eu

CCOPT_URL="${CCOPT_URL:-https://raw.githubusercontent.com/SpectorHacked/ccopt/main/dist/ccopt.cjs}"
BIN_DIR="${CCOPT_BIN_DIR:-$HOME/.local/bin}"
DEST="$BIN_DIR/ccopt"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>= 20). Install it from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: node >= 20 required, found $(node --version)" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"

# Prefer the local build when running from a checkout; otherwise download.
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/dist/ccopt.cjs" ]; then
  cp "$SCRIPT_DIR/dist/ccopt.cjs" "$DEST"
else
  curl -fsSL "$CCOPT_URL" -o "$DEST"
fi
chmod +x "$DEST"

echo "Installed: $DEST"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: add $BIN_DIR to your PATH" ;;
esac

# One-shot workspace onboarding:  install.sh --join <token>
if [ "${1:-}" = "--join" ] && [ -n "${2:-}" ]; then
  "$DEST" join "$2"
else
  "$DEST" --version >/dev/null && echo "Verify your setup with: ccopt doctor"
fi
