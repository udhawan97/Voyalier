# ADR-0004: Keep the mock gateway honest with shared golden files

- Status: Accepted
- Date: 2026-07-16
- Amended: 2026-08-26

## Context

`packages/contracts/src/mock.ts` is the in-memory `AppGateway` the component and
contract tests run against (ADR-0001, ADR-0003). Two adapters at one seam is a
real seam, and the mock earns its place: 28 web test files use it, and it needs
no storage, keychain, or network.

The problem was never that it exists. It was that roughly 990 of its lines
re-implemented `voyalier-core`'s rules in TypeScript, and more than half of those
mirrored functions that are **private** to the core — so refactoring core
internals desynchronized the mock silently. Nothing compared the two:
`gateway.live.test.ts` is `describe.skipIf(!LIVE)` and no workflow sets
`VITE_LIVE_API`, so it has never run in CI.

It had already drifted, in five places:

- Every validation limit was a Rust `pub const` and an unrelated magic number in
  the mock, measured with `.length` — UTF-16 code units, where the core counts
  characters. The mock rejected a 3001-emoji prompt the core accepts.
- `normalize_place` disagreed in **both** directions: the core sent accented
  capitals to a word separator (`"REYKJAVÍK"` → `"reykjav k"`), and the mock
  dropped `ø` and `ß`, which NFKD does not decompose (`"Tromsø"` → `"troms"`).
  Destinations are user-typed, so this decided whether a pack matched.
- The curated FCDO / State Dept / CDC / WHO links — the product's entire claim on
  entry and health, since it never asserts those rules and only points at the
  source — were maintained by hand in two languages. The only test on them
  checked that each URL starts with `https`.
- `MOCK_DRAFT_PROMPT` was a two-line paraphrase of a seven-line instruction,
  dropping the JSON shape and the ban on prices, codes, guest names, and
  visa/health/safety content — and `getAiPrompts` shows it to travelers as the
  editable default, so mock mode advertised an instruction the product never
  sends.
- `assessReadiness` had quietly dropped a parameter the core still took.

The follow-up closure found the same failure mode in pack suggestions. The mock
listed 8 packs while the core shipped 22, omitted six current city aliases, and
did not treat `"united"` as a region stopword. A contributor exercising the web
fixture therefore saw a smaller catalog and different matches than either
shell's real service.

The redacted brief mirror had also delegated ordering to locale-aware
`localeCompare`, while Rust orders strings by UTF-8 bytes. In the test runtime,
that put the `"~"` sentinel before dated items, so undated ideas appeared first
in mock mode and last through the real service.

Round-one review then found two boundary mismatches the first goldens did not
exercise. ECMAScript whitespace excludes U+0085 and includes U+FEFF, the inverse
of Rust at those two points. The mock also removed `passengerName` only from
transport and `guestName` only from lodging, while core applies the sharing
policy before fact classification and therefore removes both from every family.

## Decision

Facts both languages must agree on live in `packages/contracts/parity/*.json`.
A Rust test holds the core to each file; a TypeScript test holds the contract and
its mock to the same file. Drift on either side fails a test.

The initial decision covered `limits.json`, `normalize-place.json`,
`prompts.json`, `readiness-links.json`, and `assess-trip.json`. Later slices
extended the same pattern to other pure mirrors; this closure adds
`pack-catalog.json`, `pack-suggestions.json`, `field-suggestions.json`,
`search-score.json`, and `trip-brief.json`. Where a value can simply be _read_
rather than mirrored — the prompts, links, pack catalog, aliases, and region
stopwords — the mock imports the compact artifact directly, so there is one
production copy of the data and behavioral test cases do not enter the web
bundle.

`assess-trip.json` pins rule **output**, not just constants: twelve hand-designed
trips, each with the itinerary conflicts and readiness rollup they produce. The
constants goldens would not have caught a mirror that computed a different
verdict; this one does.

`today.json` likewise pins projection output: the full confirmed-fact family
(flight, stay, rail, coach, ferry, and rental), all traveler-authored trip-item
kinds, current and next anchors, phase calculation, source targets, and wire
omission. This caught the mock treating every non-flight fact as a stay and
therefore omitting surface journeys entirely.

The four closure goldens pin the remaining pure mirrors named by this ADR:

- `pack-catalog.json` owns the complete catalog and private alias/stopword
  tables; `pack-suggestions.json` exercises exact, alias, partial,
  ambiguous-region, and ordering behavior.
- `field-suggestions.json` exercises trimming, case-insensitive deduplication,
  ranking, metadata preservation, Rust's Unicode whitespace boundaries, and the
  eight-result cap.
- `search-score.json` pins query-token deduplication and the private lexical
  helper's coverage, occurrence, earliest-token result, and U+0085/U+FEFF split
  boundary without exposing the Rust helper publicly.
- `trip-brief.json` pins ordering and wire omission across flights, stays, every
  surface mode, and traveler-authored items. Sensitive canaries prove that
  confirmation codes, traveler names (including names placed on a different
  fact family), and private item notes exist in the inputs and never enter
  expected or actual share output.

Units are part of the agreement, not an implementation detail: every limit counts
characters, and `countChars` in the contract gives that a name so `.length` never
creeps back in.

## Alternatives considered

- **Compile `voyalier-core` to WASM and have the mock call it.** One
  implementation, no mirror at all — the strongest answer, and the right one if
  the mirror keeps growing. Rejected for now: it puts a wasm-pack toolchain and a
  build artifact between every web test and its rules, for a mirror that is
  mostly a handful of pure functions. Revisit when the mirror grows past what
  goldens can pin, or when a rule's _behavior_ (not just its constants) drifts
  again.
- **Delete the mock and test against the real service.** Loses the fast,
  hermetic, storage-free test path 28 files depend on, and browser mode has no
  keychain.
- **Make `gateway.live.test.ts` run in CI.** Worth doing, and orthogonal: it
  compares _transport_ behavior, not rule output, so it would not have caught any
  of the five drifts above.

## Consequences

- Adding a rule to the mock that the core also implements means adding a golden
  file for it. That is the cost, and it is the point.
- Golden **inputs** are hand-designed; that is where the thought goes, and where
  boundaries (back-to-back flights, a gap at the trip's edge, a stay with no
  dates) get chosen deliberately. Two of the five original drifts were bugs on
  the _core's_ side, which hand-writing `normalize-place.json`'s expectations is
  what surfaced.
- Golden **outputs** for `assess-trip.json` are generated from the core and then
  reviewed, because hand-writing a nested `ReadinessSummary` twelve times would
  be transcription, not thought. The core is the reference implementation and has
  its own unit tests judging whether it is _right_; this file judges whether the
  mock _agrees_. Regenerate deliberately, never to turn a red test green. The
  file records one known quirk it found rather than hiding it: a stay with no
  dates reports full lodging coverage, in both languages.
- A shared limit now has one declaration. Changing it fails both languages' tests
  until both follow, which is the intended friction.
- Readiness, itinerary conflicts, Today, pack and field suggestions, lexical
  scoring, and trip-brief redaction are pinned by output. The finite list of
  unpinned pure mirrors recorded by this ADR is closed; any new cross-language
  rule must add its parity evidence in the same change.

Related: [ADR-0001](ADR-0001-system-shape.md),
[ADR-0003](ADR-0003-phase2-contract.md).
