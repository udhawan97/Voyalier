# ADR-0010: `AppService` splits its implementation, not its interface

- Status: Accepted
- Date: 2026-07-29

## Context

`crates/voyalier-app/src/lib.rs` is 10,099 lines. `impl AppService` accounts for 2,889 of them
(816–3705) across 95 methods, and the inline `#[cfg(test)] mod tests` for another ~4,600 —
about 45% of the file. Everything else the crate owns (the vault, `MIGRATIONS`, the eleven
migration steps, `init_connection`, the snapshot loaders, the SQL converters) sits in the same
file.

The obvious reading is "god object, split it". That reading is wrong about the interface and
right about the file, and the difference matters.

`AppService` is a **deep module**, and deliberately so. Both shells depend on exactly one type:
`voyalier-server` and `apps/desktop/src-tauri` are thin adapters over it, and
`packages/contracts` describes its surface as one `AppGateway`. Splitting the type into
`TripService`, `PackService`, `AssistService`, and so on would mean every caller — both
transports, every test — learns several types where it now learns one. That is a **wider
interface over the same behaviour**, which is the definition of making a module shallower. The
`AppGateway` contract would then either fragment to match, or stay whole and paper over a split
that bought nothing.

What is genuinely hard is not the interface but the file. The subsystems are already clustered
in it and only accidentally interleaved — `create_trip` is at 988 and `update_trip` at 3122,
with packs, providers, backup, snapshots, search, and assist in between. Reading one subsystem
means scrolling past six others, and that cost falls on every reader, human or otherwise.

## Decision

Keep one `AppService` with one interface. Split its **implementation** across modules, using
the same multi-module inherent `impl` that ADR-0007 already relies on for `Vault::seal`.

- `lib.rs` keeps the struct, its constructors, `health`, the shared private helpers
  (`connection`, `records`), the vault, the migrations, and the SQL converters.
- One module per subsystem takes its `impl AppService` block: trips, planning, packs,
  providers, backup, snapshots, search, assist, documents, visa.
- The test module moves to `crates/voyalier-app/src/tests.rs` behind `#[cfg(test)] mod tests;`,
  which is exactly what `voyalier-core` already does (`lib.rs:155`). This is still an inline
  `#[cfg(test)] mod tests` in the sense `AGENTS.md` requires — there is no `tests/` directory
  and no integration-test harness.

No method signature, no visibility, and no behaviour changes. The public surface after this
change is byte-for-byte the surface before it.

## Consequences

- A subsystem can be read, and changed, without scrolling through six unrelated ones. The
  crate's own architecture becomes visible from its file listing rather than only from a
  careful read.
- `AppService` stays exactly as deep as it was. Callers and tests still cross one interface.
- Internal seams stay internal. `Records`, `Vault`, `Sealed`, `AdviceFetcher`, and
  `SecretStore` are unchanged; this adds no new trait and no new indirection.
- The diff is large and almost entirely movement. Reviewing it means checking that nothing
  changed rather than reading it line by line; `cargo` verifies that mechanically, and the 82
  app tests verify the behaviour.
- `lib.rs` remains the largest module in the crate, because the vault, the migration ledger,
  and `init_connection` genuinely belong with the type that owns the connection. Splitting
  those out too would be movement for its own sake.

## Alternatives considered

**Split the type.** Rejected above: it widens the interface both transports and every test
depend on, in exchange for file organisation that a module split gives for free.

**Extract subsystems behind their own traits** (a `TripStore`, a `PackStore`). Rejected on the
seam rule — one adapter means a hypothetical seam. Nothing varies across these boundaries;
there is one implementation of each and no second one in prospect. The three seams that do
have two adapters (`AdviceFetcher`, `SecretStore`, `ConfirmationParser`) already exist.

**Leave it.** Defensible — nothing is broken, and Rust tooling navigates by symbol. Rejected
because the file is still growing (planning added ~380 lines in 0.5.0, visa ~150 in 0.6.0),
every one of those landed in the middle of an unrelated subsystem, and the cost is paid on
every read.
