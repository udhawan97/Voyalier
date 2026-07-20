#!/usr/bin/env bash
# Start a disposable real Axum service for Playwright. Playwright owns this
# process and terminates it after the browser run; the trap removes its database.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
playwright_tmp=$(mktemp -d "${TMPDIR:-/tmp}/voyalier-playwright.XXXXXX")

cleanup() {
  rm -rf "$playwright_tmp"
}
trap cleanup EXIT INT TERM

cd "$repo_root"
VOYALIER_BIND=127.0.0.1:8787 \
VOYALIER_DATA_DIR="$playwright_tmp/data" \
VOYALIER_INTEGRATION_TEST=1 \
VOYALIER_LOG=warn \
  cargo run --locked -p voyalier-server
