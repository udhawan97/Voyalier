# Mock rule parity closure plan

The Today and disruption continuity phase exposed a real adapter drift: Rust emitted surface
journeys in Today while the shipped in-memory gateway silently dropped them. The shared Today
golden fixed that path, but ADR-0004 still names four Rust rules with hand-written TypeScript
mirrors and no cross-language output check. This phase closes that finite list before another
product feature can build tests on behavior the real service does not share.

## Product and architecture boundary

- This is conformance work, not a new traveler capability. Existing Rust behavior remains the
  reference implementation; generated outputs are reviewed rather than accepted automatically.
- No gateway method, HTTP route, Tauri command, contract field, persistence, migration, sealed
  column, provider, consent surface, network request, model prompt, version, release, or public
  product claim changes.
- Pack suggestions remain deterministic local catalog matches, field suggestions remain local
  previously-known values, and search scoring remains lexical and local.
- Trip-brief parity must preserve generation-time exclusion: confirmation codes and traveler names
  never enter the shareable structure. Full trip items, including private notes, may enter the
  formatter; its `BriefTripItem` projection must exclude notes. Imported text, resources, and chat
  remain outside the formatter input.
- Test-only exports from `packages/contracts/src/mock.ts` do not expand `AppGateway`; they exist only
  so the web parity suite can exercise the shipped mock's pure mirrors directly.
- Amend ADR-0004 with the four new goldens and remove its completed debt list. No new ADR is needed
  because the accepted parity decision and product behavior do not change.

## Slice 1 - Pin catalog and field-suggestion rules

Add shared goldens for `suggest_packs` / `mockSuggestPacks` and
`rank_field_suggestions` / `mockRankFieldSuggestions`.

Acceptance:

- Pack cases cover blank and unknown destinations, exact city/article matches, aliases, ambiguous
  country matches, region partial matches, and tier ordering. A compact production artifact pins the
  complete catalog plus the private alias and stopword tables without shipping behavioral fixtures.
- Field cases cover trimming, blank removal, case-insensitive deduplication, empty queries, prefix
  before substring, stable source priority, preserved detail, Rust's Unicode whitespace boundaries,
  contextual Unicode lowercase behavior, and the eight-result cap.
- Both Rust and TypeScript pin the exact case count and compare serialized output.

## Slice 2 - Pin lexical search scoring

Add one shared golden for the private Rust `score_haystack` helper and the TypeScript
`scoreHaystack` mirror. Keep the Rust test inside `search.rs`; do not re-export a private core
implementation merely to reach it.

Acceptance:

- Cases cover no match, duplicate query-token handling at the caller boundary, distinct-token and
  occurrence counts, overlapping occurrence semantics, earliest-token selection, Rust's U+0085 and
  U+FEFF whitespace boundaries, contextual Unicode lowercase behavior, and saturating/bounded output
  behavior where applicable.
- The golden pins the helper's serialized `{ matched, occurrences, first }` output without changing
  the public search contract or ranking algorithm.

## Slice 3 - Pin the redacted brief boundary

Add a shared golden for `build_trip_brief` with sharing policy and `buildShareBrief`.

Acceptance:

- Cases cover empty and full trips; flights, stays, every surface mode, and every trip-item kind;
  chronological and stable tie ordering; optional wire-field omission; and a fixed `generatedAt`.
- Expected output proves confirmation codes, passenger/guest names, and private trip-item notes do
  not enter the brief, including name fields placed on a non-customary fact family, while the sharing
  policy deliberately retains a lodging address and public station/port/depot names.
- A structural assertion scans both input fixtures and output to prove the sensitive canaries exist
  only in input and never in expected/actual output.

## Verification and delivery

1. Commit this plan before implementation.
2. Add the shared inputs and Rust reference-generation tests, generate expected output with
   `VOYALIER_REGENERATE_GOLDEN=1`, confirm the intentional panic, and review every generated diff.
3. Add TypeScript assertions and test-only mock exports; first demonstrate the new tests fail for
   an intentional mirror mutation, then revert the mutation.
4. Resolve any real drift in the mock and amend ADR-0004.
5. Run focused Rust and Vitest parity suites, contracts/web typechecks, `make check`, production
   dependency audit, an automated production-bundle exclusion check, credential scan, locked Cargo
   metadata, and `git diff --check`.
6. Refresh Graphify and verify a scoped query connects all four golden pairs.
7. Run exactly two four-seat council rounds and resolve every valid blocker.
8. Close the branch with `Merge: mock rule parity closure`, fast-forward verified `main`, push it,
   and wait for required remote checks. Do not create a version, tag, release, or manual deployment;
   report any automatic GitHub Pages deployment caused by the existing `main` workflow.

## Commit order

1. `Docs: plan mock rule parity closure`
2. `Core+contract+test: pin remaining mock rule mirrors`
3. `Docs: close mock rule parity debt`
4. `Core+contract+test: resolve council parity blockers`
5. `Docs: record council parity hardening`
6. `Test+docs: enforce parity fixtures stay out of bundles`
7. `Merge: mock rule parity closure`
