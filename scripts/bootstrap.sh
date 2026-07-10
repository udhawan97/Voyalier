#!/usr/bin/env bash
set -euo pipefail

for command in node pnpm rustc cargo; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    echo "See README.md for the supported toolchain." >&2
    exit 1
  fi
done

pnpm install
cargo fetch

echo "Voyalier dependencies are ready. Run: make dev"
