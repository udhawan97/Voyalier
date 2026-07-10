#!/usr/bin/env bash
set -euo pipefail

pnpm check
cargo fmt --all -- --check
cargo clippy --locked -p voyalier-core -p voyalier-server --all-targets -- -D warnings
cargo test --locked -p voyalier-core -p voyalier-server
