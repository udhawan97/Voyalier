# ADR-0004: Keep the mock gateway honest with shared golden files

- Status: Accepted
- Date: 2026-07-16

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

## Decision

Facts both languages must agree on live in `packages/contracts/parity/*.json`.
A Rust test holds the core to each file; a TypeScript test holds the contract and
its mock to the same file. Drift on either side fails a test.

Today that covers `limits.json`, `normalize-place.json`, `prompts.json`, and
`readiness-links.json`. Where a value can simply be _read_ rather than mirrored —
the prompts and the links — the mock imports the file directly, so there is one
copy of the text and nothing to keep in sync.

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
- The goldens are hand-written, not generated. A generated file would encode
  whatever the core does today, including its bugs — two of the five drifts were
  bugs on the _core's_ side, and writing the cases by hand is what surfaced them.
- A shared limit now has one declaration. Changing it fails both languages' tests
  until both follow, which is the intended friction.
- `mock.ts` still mirrors rule _logic_ (readiness, itinerary conflicts, Today,
  search, packs). Those mirrors are unpinned; the goldens cover the constants and
  the folding. Extending them to rule output — feed fixture inputs to both and
  compare — is the next step if drift shows up there.

Related: [ADR-0001](ADR-0001-system-shape.md),
[ADR-0003](ADR-0003-phase2-contract.md).
