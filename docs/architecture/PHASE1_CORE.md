# Phase 1 Core Slice

## Starting point

Phase 1 starts from `dda112278776d3307c17cdf2e260edda23cc987b`, the repository-allowed squash merge of "Phase 0: contract freeze".

GitHub rejected a literal merge-commit merge because merge commits are disabled for this repository. The squash commit above is the main commit containing the frozen Phase 0 contract.

## Decisions

- `crates/voyalier-core` owns contract-aligned Rust types, deterministic validation, parser traits, and pure JSON-LD/plaintext parsers. It performs no storage, network, Tauri, or Axum work.
- `crates/voyalier-app` owns application services and SQLite persistence. It enables WAL, foreign keys, and a busy timeout, migrates the schema by `PRAGMA user_version`, and uses `VOYALIER_DATA_DIR` or `ProjectDirs("com", "voyalier", "Voyalier")`.
- Raw source document content is stored only in SQLite and is never returned by `SourceDocument`, `ImportResult`, HTTP responses, or Tauri command responses.
- Desktop transport is direct Tauri IPC only. The desktop crate no longer depends on Axum or `voyalier-server`, and it starts no TCP listener.
- Browser development continues through Axum on `127.0.0.1:8787`, with Vite-only CORS plus Host and Origin validation.
- Parser fixtures are entirely synthetic. The prompt-injection fixture is treated as inert quoted source text.

## Commands to run

```bash
cargo fmt --all -- --check
cargo clippy --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop --all-targets -- -D warnings
cargo test --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop
./scripts/check.sh
git diff dda112278776d3307c17cdf2e260edda23cc987b -- packages/contracts/src/
```

## Verification performed

- `cargo test -p voyalier-core -p voyalier-app`
- `cargo test -p voyalier-server`
- `cargo test -p voyalier-desktop --lib`
- `cargo fmt --all -- --check`
- `cargo clippy --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop --all-targets -- -D warnings`
- `cargo test --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop`
- `PATH=/Users/umang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH ./scripts/check.sh`
- `git diff --check`
- `git diff dda112278776d3307c17cdf2e260edda23cc987b -- packages/contracts/src/` produced no output.

## CHANGELOG-ready entries

### Added

- Added `voyalier-app`, a SQLite-backed local application service layer implementing trip, document import, candidate review, and confirmed-fact operations.
- Added deterministic JSON-LD and plaintext parser fixtures and a parser evaluation harness in `voyalier-core`.
- Added Rust JSON Schema drift tests for the frozen contract schemas.
- Added Tauri IPC command round-trip tests for every frozen command name and the required `input` argument key.

### Changed

- Routed browser development through the shared app services and the full frozen HTTP API.
- Reworked desktop transport from a fixed loopback listener to direct Tauri IPC.
- Expanded CI and local checks to cover `voyalier-app` and desktop IPC tests.
