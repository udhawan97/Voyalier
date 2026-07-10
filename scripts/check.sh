#!/usr/bin/env bash
set -euo pipefail

pnpm check
cargo fmt --all -- --check
cargo clippy -p voyalier-core -p voyalier-server --all-targets -- -D warnings
cargo test -p voyalier-core -p voyalier-server
