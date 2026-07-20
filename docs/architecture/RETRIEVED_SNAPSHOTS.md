# Retrieved snapshots

Voyalier stores user-requested copies of remote information so a trip remains
useful offline and so the interface can say exactly what was retrieved, from
where, and when. Weather, government advice, destination facts, public
holidays, and place summaries are all retrieved snapshots.

## The seam

`crates/voyalier-app/src/snapshots.rs` owns the cross-source protocol for when a
snapshot stops describing the trip. Its small internal interface accepts the
validated trip before and after an edit and invalidates every affected source
inside the same SQLite transaction as the trip update.

This is a deep module because it hides three pieces of implementation callers
must not reconstruct:

- the complete registry of snapshot tables;
- each source's staleness rule (destination, date window, or origin); and
- the transactional deletes needed to prevent an old destination from staying
  visible after an edit.

The app layer is the seam because this is persistence policy. Core remains
IO-free, while Axum and Tauri continue to call `AppService` without learning
which tables hold retrieved data.

## Source-owned payloads

The module deliberately does **not** define one generic `RetrievedSnapshot<T>`
storage interface. The sources are not interchangeable:

- advisory panels preserve several governments independently and keep the last
  good entry when one source is down;
- weather is scoped to both place and travel window and contains several
  optional evidence layers;
- destination facts compare two endpoints and derive additional offline facts
  on read;
- public holidays are re-filtered to the trip window on read; and
- place summaries retain Wikimedia attribution and page identity.

Their typed payloads, parsers, provenance, and source-specific persistence stay
owned by those source paths. Flattening them into a JSON blob or a universal
trait would hide fewer rules than it exposes, weaken schema migration clarity,
and create a hypothetical seam with no second adapter.

## Invariants

1. Remote retrieval happens only after an explicit user action.
2. Every stored source preserves its retrieval time and required attribution;
   source URLs and source update times are preserved where the provider exposes
   them.
3. A failed refresh does not become a false "all clear" state.
4. A trip edit and the invalidation it triggers commit atomically.
5. Every trip-keyed snapshot table must declare a staleness rule. A schema test
   compares the registry with SQLite so omission fails the repository gate.
6. User-authored documents, confirmed facts, notes, assist history, and
   downloaded packs are not retrieved snapshots and survive a destination edit.

Adding a new retrieved source therefore requires two explicit decisions: its
source-specific storage/provenance behavior, and the trip edit that makes its
stored result stale.
