#!/bin/bash
# We Link — local preview server
# Usage: double-click run.sh OR run `bash run.sh` in terminal

cd "$(dirname "$0")"

PORT=3000

echo ""
echo "  We Link — starting local server on http://localhost:$PORT"
echo "  Press Ctrl+C to stop."
echo ""

# Try Python 3 first (pre-installed on macOS 12+)
if command -v python3 &>/dev/null; then
  python3 -m http.server $PORT
# Fallback: Python 2
elif command -v python &>/dev/null; then
  python -m SimpleHTTPServer $PORT
# Fallback: Node npx serve
elif command -v npx &>/dev/null; then
  npx --yes serve -l $PORT .
else
  echo "  ERROR: No suitable server found."
  echo "  Install Node.js (https://nodejs.org) and re-run this script."
  exit 1
fi
