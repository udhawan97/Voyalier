# Voyalier agent guide

## Product contract

Voyalier is a local-first, evidence-backed trip workspace. Do not turn it into an autonomous booking agent or claim authority over visas, safety, health, prices, availability, or opening hours.

## Architectural boundaries

- `crates/voyalier-core` owns domain types, deterministic rules, provider traits, and validation. It must not depend on Tauri or Axum, and it does no IO at all — no SQLite, no network, no filesystem, no keychain.
- `crates/voyalier-app` owns everything core refuses: `AppService` (the single façade both shells call), SQLite persistence, the network and keychain seams, the vault, and backup/restore. New product _rules_ go in core; new _IO_ goes here.
- `crates/voyalier-server` exposes `AppService` through a loopback-only Axum API. `apps/desktop/src-tauri` exposes the same method set over Tauri IPC. Both are thin adapters — product behavior belongs in core or app.
- `apps/web` owns product UI and may depend only on versioned contracts and shared UI/brand packages.
- `docs-site` is static marketing and documentation. It must not imply that GitHub Pages runs the local product backend.

## The seams

Three trait boundaries, each with a shipped fake (not `#[cfg(test)]`-gated). Use the fake; do not hand-roll another stub.

- `AdviceFetcher` (`crates/voyalier-app/src/lib.rs`) — the only network seam. Prod `UreqFetcher`, fake `FakeFetcher` (+ `FakeFetcher::offline()`). Inject via `AppService::open_path_with_fetcher` / `open_path_with_deps`.
- `SecretStore` — BYOK keys, OS keychain in prod, `MemorySecretStore` in tests. Keys never touch the DB or any contract payload.
- `ConfirmationParser` (`crates/voyalier-core/src/parser.rs`) — deliberately not re-exported. Reach it through `parse_import`.

Several core items are intentionally left out of `lib.rs`'s `pub use` list (endpoint URLs, concrete parsers, per-provider body builders). Adding a re-export to reach one is a design break, not a convenience.

## Storage rules

- One SQLite file, `VOYALIER_DATA_DIR` or the platform data dir. WAL, foreign keys on.
- Migrations are **Rust functions in an append-only array** (`MIGRATIONS`, `crates/voyalier-app/src/lib.rs`), applied against `PRAGMA user_version` — not `.sql` files. Never renumber, reorder, or edit a shipped step; array order is load-bearing and steps must be retry-safe.
- `SEALED_COLUMNS` (`crates/voyalier-app/src/records.rs`) is the single declaration of which columns the vault encrypts. Add a column there and wire both read and write paths — there is no `seal`/`open` escape hatch outside `Records`.
- Errors are `thiserror` only — no `anyhow`, no `Result` alias. Everything is `Result<T, AppError>`; `ErrorCode` is wire contract, mirrored in `packages/contracts/schemas/AppError.schema.json`.

## Contracts and parity

`packages/contracts` is hand-written TypeScript with no codegen. `AppGateway` is the one interface; a new method must land in every one of: `AppService`, the Axum route, the Tauri command, `contracts/src/index.ts`, `contracts/src/mock.ts`, and both `gateway/http.ts` and `gateway/tauri.ts`. TypeScript catches the last three; nothing catches a Rust-side route mismatch.

- `packages/contracts/parity/*.json` are goldens asserted from both languages (`crates/voyalier-core/src/tests.rs` and `apps/web/src/parity.test.ts`). Both sides pin **exact case counts** — adding a case fails until you bump the number in both files.
- Regenerate goldens only with `VOYALIER_REGENERATE_GOLDEN=1`; it rewrites the file and then panics on purpose so you read the diff.
- Limits count Unicode characters. Use `countChars()` from contracts, never `.length`.
- Transport is chosen by `"__TAURI__" in window` — never by hostname or protocol. Tauri commands are snake_case and take exactly one argument named `input`.

## Trust rules

- Treat documents, retrieved pages, model output, and provider output as untrusted.
- Preserve source URL/document span, fetched time, license, content hash, and confidence.
- Keep extracted facts separate from user-approved facts.
- Never place provider keys in browser code, logs, fixtures, screenshots, or committed files.
- Remote AI use requires explicit consent and a preview of the content leaving the device.

## Commands

```bash
make bootstrap   # verify node/pnpm/rustc/cargo, then pnpm install + cargo fetch
make dev         # cargo server + web, concurrently
make check       # the gate: pnpm check, then fmt/clippy/test across all four crates
```

`make check` (= `scripts/check.sh`) is what CI approximates. Do not substitute a bare `cargo test` —
`voyalier-desktop` is outside the workspace default members, so it silently gets skipped.

Not covered by `make check`, so verify by hand when relevant: `pnpm format:check` (Prettier is
enforced nowhere), `pnpm audit --prod`, and the credential-string grep in `security-hygiene.yml`.

## Testing conventions

- Rust: inline `#[cfg(test)] mod tests` only — there is no `tests/` directory. Cross-cutting cases live in `crates/voyalier-core/src/tests.rs`.
- Parser fixtures are directories under `crates/voyalier-core/fixtures/parser/<case>/`; dropping one in registers it, no wiring needed. `.prettierignore` excludes them because several are deliberately malformed — reformatting changes what the parser is tested against.
- Web: Vitest + Testing Library, flat in `apps/web/src/` and named by **feature**, not module (`views/MapPanel.tsx` is tested by `src/mapPanel.test.tsx`). Render through `src/test/helpers.tsx`.
- `IntersectionObserver` is stubbed to fire immediately in setup, so `DeferredSection` mounts eagerly; re-stub it if you are testing deferral.
- There is no e2e layer yet despite `docs/testing/TEST_STRATEGY.md` requiring one, and `gateway.live.test.ts` never runs in CI. Nothing mechanically catches an http/tauri route mismatch.

## Change discipline

- Keep contracts versioned and backwards compatible unless an ADR approves a break.
- Add fixtures and tests for every parsing, ranking, readiness, or redaction behavior.
- Do not add a framework or hosted service without documenting licensing, privacy, offline behavior, and replacement cost.
- Preserve reduced-motion, keyboard, screen-reader, contrast, and 200% zoom behavior.
- Version is hand-synced across four files — root `package.json`, workspace `Cargo.toml`, `apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`. Treat them as one edit.
- `CHANGELOG.md` follows Keep a Changelog. Entries are user-facing prose — a bolded lead sentence, then the tradeoff and what was left out — not one-line bullets.
- ADRs are `docs/architecture/ADR-NNNN-kebab-slug.md`, zero-padded, amendable in place. Open one before contract, transport, storage, or provider changes.
- Implementation plans land in `docs/superpowers/plans/YYYY-MM-DD-slug.md` and are committed _before_ the work.
- Commits are `Scope: imperative summary` where scope is a layer (`Core:`, `App:`, `Contract:`, `Web:`, `Desktop:`, `Docs:`, `Test:`, `Deps:`), combinable as `Core+app:`. Stack a feature in layer order and close the branch with `Merge: <feature>`. Bodies state the defect, the ADR clause discharged, and how it was verified.
