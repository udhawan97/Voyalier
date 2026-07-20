#!/usr/bin/env bash
# The gate. `make check` runs every stage; CI runs one stage per job so the
# four of them go in parallel. Either way the commands live only here — CI
# must never inline a check, or the two drift and only one of them is right.
set -euo pipefail

# Split from desktop because CI builds desktop in its own job, the only one
# that installs the heavy Tauri system dependencies.
LIB_CRATES=(-p voyalier-core -p voyalier-app -p voyalier-server)
DESKTOP_CRATES=(-p voyalier-desktop)

stage_web() {
  pnpm format:check
  pnpm check
}

stage_rust() {
  cargo fmt --all -- --check
  cargo clippy --locked "${LIB_CRATES[@]}" --all-targets -- -D warnings
  cargo test --locked "${LIB_CRATES[@]}"
}

stage_desktop() {
  cargo clippy --locked "${DESKTOP_CRATES[@]}" --all-targets -- -D warnings
  cargo test --locked "${DESKTOP_CRATES[@]}"
}

stage_integration() {
  ./scripts/check-live-http.sh
  pnpm test:e2e
}

case "${1:-all}" in
web) stage_web ;;
rust) stage_rust ;;
desktop) stage_desktop ;;
integration) stage_integration ;;
all)
  stage_web
  stage_rust
  stage_desktop
  stage_integration
  ;;
*)
  echo "usage: $0 [all|web|rust|desktop|integration]" >&2
  exit 2
  ;;
esac
