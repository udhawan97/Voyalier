#!/usr/bin/env bash
set -euo pipefail

pnpm check
cargo fmt --all -- --check
cargo clippy --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop --all-targets -- -D warnings
cargo test --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop
