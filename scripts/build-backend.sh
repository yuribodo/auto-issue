#!/usr/bin/env bash
# Build the Go backend binary for the current platform into desktop/resources/backend/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
OUTPUT_DIR="$ROOT_DIR/desktop/resources/backend"

mkdir -p "$OUTPUT_DIR"

# Determine target OS and architecture
GOOS="${GOOS:-$(go env GOOS)}"
GOARCH="${GOARCH:-$(go env GOARCH)}"

# Binary name
BINARY="auto-issue-backend"
if [ "$GOOS" = "windows" ]; then
  BINARY="auto-issue-backend.exe"
fi

# Disable CGO on Windows (creack/pty is Unix-only)
if [ "$GOOS" = "windows" ]; then
  export CGO_ENABLED=0
fi

echo "Building backend for $GOOS/$GOARCH → $OUTPUT_DIR/$BINARY"

cd "$BACKEND_DIR"
GOOS="$GOOS" GOARCH="$GOARCH" go build -ldflags="-s -w" -o "$OUTPUT_DIR/$BINARY" ./cmd/server

echo "Done: $OUTPUT_DIR/$BINARY ($(du -h "$OUTPUT_DIR/$BINARY" | cut -f1))"
