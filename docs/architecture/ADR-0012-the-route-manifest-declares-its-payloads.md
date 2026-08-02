# ADR-0012: The route manifest declares its payloads

Status: accepted, 2026-08-01
Supersedes nothing. Extends ADR-0002 (desktop transport), ADR-0011 (the manifest is used, not only asserted).

## The gap

`packages/contracts/parity/routes.json` declares each `AppGateway` method's HTTP verb, HTTP
path, and Tauri command. TypeScript declares every signature three times over, through
`): AppGateway` on the mock and both gateways. Between those two facts there is a hole:

**Nothing declares the request payload.**

Concretely. `apps/web/src/gateway/tauri.ts` sends

```ts
updateTrip: (tripId, input) =>
  call<Trip>(command("updateTrip"), { tripId, patch: input }),
```

against a Rust struct in `apps/desktop/src-tauri/src/lib.rs` that expects exactly those two
JSON keys:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTripCommandInput {
    trip_id: String,
    patch: UpdateTripInput,
}
```

Rename `patch` to `changes` on the TypeScript side alone and **everything passes**. The
argument is typed `Record<string, unknown>` by `InvokeFn`, so `tsc` is content.
`generate_handler_registers_every_declared_command` compares names, not payloads.
`every_shared_command_binds_its_argument_to_input` sends `json!({})` with no envelope at all
and only inspects Tauri's own binding-error string. `routeParity.test.ts` records the command
name and discards the arguments — its own comment says so: _"Values matter only where they
reach the URL."_

The desktop trip editor would be dead, and `make check` would be green.

This is not one method. Across the 81 shared methods:

- **50 Tauri calls hand-construct an argument object** with literal key names, against 29
  locally-declared wrapper structs.
- **14 HTTP calls hand-build a request body**, against 16 locally-declared body structs.
- **8 HTTP calls build a query string**, against 6 query structs — four of which carry no
  `rename_all`, so the expected key is a bare identifier with nothing announcing it.

72 of 81 methods write at least one wire key by hand on one side and read it by name on the
other, with nothing comparing the two.

Every one of them currently matches. That is the point: this ADR is not fixing a bug, it is
closing the way a bug gets in unseen.

## The precedent this follows

ADR-0011 established that the manifest is **consumed**, not merely asserted: `http.ts` derives
its verb and path from it, `tauri.ts` derives its command name. A declaration nothing reads
rots, which is why that ADR exists at all.

Payload keys cannot be consumed the same way — the gateway must write `{ tripId, patch: input }`
somewhere, and reconstructing that shape from a key list would be the untyped dispatcher
ADR-0011 already refused. So payloads are **asserted from three sides** instead:

1. `apps/web/src/routeParity.test.ts` drives each method through a recording transport and
   compares the keys actually put on the wire to the manifest.
2. `voyalier-desktop` reads each command's input type out of its own source, resolves that
   struct's serde field names, and compares them to the manifest.
3. `voyalier-server` does the same for each handler's `Json<T>` and `Query<T>` extractors.

Any two of those agreeing while the third disagrees is a failure. That is what the current
guards cannot express.

## The declaration

Each `shared` row gains a `payload` object:

```json
{
  "method": "updateTrip",
  "verb": "PATCH",
  "path": "/api/v1/trips/{tripId}",
  "command": "update_trip",
  "payload": {
    "command": ["tripId", "patch"],
    "body": "input",
    "query": []
  }
}
```

- **`command`** — the keys inside the Tauri `input` envelope. Either a literal array, or the
  string `"input"` when the gateway forwards the whole typed input object.
- **`body`** — the HTTP request body: `null` when there is none, `"input"` for a whole
  forwarded object, or a literal array of keys.
- **`query`** — the query-string keys, `[]` when there are none.

`"input"` is a classification, not an absence. A row saying `"input"` asserts that the Rust
side takes a shared `voyalier-core` type; a row with a literal array asserts it takes a
locally-declared struct whose serde keys are exactly those. The two cannot be confused,
because each guard checks which kind it is looking at.

## What this deliberately does not cover

**The shared-type boundary.** When a row says `"input"`, the gateway forwards a
`voyalier-core` type serialized by TypeScript's own interface. Renaming
`UpdateTripInput.startDate` to `.departDate` in `packages/contracts/src/index.ts` while
leaving Rust's `start_date` alone still compiles and still passes. That is a second, larger
hole — 18 HTTP bodies and 21 Tauri calls wide — and closing it means comparing TypeScript
interfaces to Rust structs field by field, in both directions, across a crate boundary. It
needs its own ADR and probably its own mechanism; a guard that reads `.rs` files out of
another crate with `include_str!` is not obviously better than the drift it prevents.

Recording it here so the next review does not rediscover it as if it were new.

**A generated manifest.** `packages/contracts/parity/routes.json` stays hand-maintained, as
AGENTS.md requires. Generating the payload lists from the gateway source would make the
TypeScript assertion tautological — the failure mode ADR-0011 already warns the transport
suites are close to.

**A schema crate.** `schemars` is in `Cargo.lock` three times over, but only transitively via
`tauri-build` and friends; no Voyalier crate depends on it directly. Adding one to enumerate
serde field names at runtime would buy a more robust guard than source parsing, at the cost of
a dependency, a derive on ~45 structs, and a licensing and offline-behavior review that
AGENTS.md requires for any new framework. The three existing parity guards already read Rust
source and already carry self-checks that fail if the parser goes blind. This follows them.

## Consequences

- Adding a method now costs one more manifest field. It was already ten places; this does not
  change the order of magnitude, and the field is three short lists.
- Each Rust guard gains a self-check banning the extractor and signature forms its parser
  cannot see, mirroring `the_router_uses_only_wiring_forms_the_parity_parser_understands`. A
  parser that silently stops matching is worse than no parser.
- `ARGS` in `routeParity.test.ts` becomes load-bearing where it was decorative. Its own comment
  said values only mattered where they reached the URL; that stops being true, and the comment
  is corrected.
- The 8 query rows are the most valuable and the least obvious: `suggestFieldValues` maps
  `input.query` onto the wire key `q`, which appears in neither the contract nor the manifest
  today, and `SearchQuery` has no `rename_all` to hint at it.
