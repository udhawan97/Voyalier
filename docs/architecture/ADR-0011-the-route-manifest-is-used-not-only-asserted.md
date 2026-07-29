# ADR-0011: The route manifest is used, not only asserted

- Status: Accepted
- Date: 2026-07-29

## Context

Adding one method to `AppGateway` means writing it in ten places: `AppService`, the Axum route,
the Axum handler, the Tauri command, `generate_handler!`, `contracts/src/index.ts`,
`contracts/src/mock.ts`, `gateway/http.ts`, `gateway/tauri.ts`, and `parity/routes.json`.
Commit `fe5e246` added three methods across six files, +113/−6, containing no logic at all.

The obvious conclusion is "generate it". Before accepting that, two things were measured.

**Every one of the ten sites is already enforced.** Nothing in this ritual can drift silently:

| Site               | Enforced by                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `index.ts`         | it _is_ the declaration                                               |
| `mock.ts`          | typed `const gateway: AppGateway` (`mock.ts:1884`)                    |
| `http.ts`          | typed `): AppGateway` (`http.ts:88`)                                  |
| `tauri.ts`         | typed `): AppGateway` (`tauri.ts:89`)                                 |
| `routes.json`      | `ARGS: Record<keyof AppGateway, unknown[]>`, compiler-forced          |
| Axum route+handler | `the_router_declares_exactly_the_manifest` (both directions)          |
| Tauri command      | `generate_handler_registers_every_declared_command` + the 0.6.1 guard |
| `AppService`       | the Rust adapters do not compile without it                           |

So the cost of the ritual is typing, not risk. That reframes what a fix has to be worth.

**Each proposed collapse trades away a guarantee.**

- _Generating `http.ts` and `tauri.ts` from the manifest._ Both are currently typed
  `): AppGateway`, so TypeScript checks all 71 signatures and return types against the
  contract. A manifest-driven dispatcher produces an untyped method table and needs one
  `as unknown as AppGateway`, which discards that check for every method at once. The 804 lines
  are boring, but they are the type-checked bridge between the contract and the wire.
- _A Rust macro for the handlers and commands._ `voyalier-server`'s parity guard reads routes
  out of `pub fn app`'s **source**, and `voyalier-desktop`'s reads identifiers out of
  `generate_handler!`'s source. `the_router_uses_only_wiring_forms_the_parity_parser_understands`
  exists to keep them readable and bans `.merge(`, `.nest`, `any(`, and friends by name. A macro
  that emitted routes would blind both guards — trading four enforced sites for two unenforced
  ones.
- _Inlining handlers as closures at the route._ Same problem: the manifest's `command` field
  doubles as the expected handler name, so an anonymous closure has nothing to match.

## Decision

Do not generate anything. Instead, make the manifest **load-bearing**: `http.ts` and `tauri.ts`
stop restating the verb, path, and command name that `parity/routes.json` already declares, and
read them from it.

```ts
// before — the path shape is written twice, here and in the manifest
getTrip: (tripId: string) =>
  request<TripDetail>("GET", `/api/v1/trips/${enc(tripId)}`),

// after — the manifest is the only place it is written
getTrip: (tripId: string) => request<TripDetail>(...route("getTrip", { tripId })),
```

The arrow keeps its signature and its return type, so `): AppGateway` still checks all 71
methods. What leaves is the duplicated literal. Which argument fills which placeholder stays at
the call site, named, because it is the one genuinely per-method fact — and `route()` throws on
an unfilled placeholder, which the existing parity test surfaces because it drives every method.

`AGENTS.md`'s rule that `routes.json` "is hand-maintained — never regenerate it from a gateway"
is untouched, and so is "no codegen". This is the opposite direction: the hand-maintained
declaration is now consumed rather than only compared against.

## Consequences

- Verb, path, and command exist once each instead of twice. A path change is a one-line edit to
  the manifest.
- The chain that keeps the web client honest is now: `http.ts` derives from the manifest, and
  `the_router_declares_exactly_the_manifest` holds the manifest to the router. One link shorter
  than before, and the link that was removed was the one maintained by hand.
- **`routeParity.test.ts`'s two transport assertions weaken.** They compared a literal against
  the manifest; they now compare a derivation against its own source, which is close to
  tautological. They are kept because they still catch a broken placeholder binding, an
  unfilled parameter, and a method wired to the wrong row — but the load has moved to the Rust
  side, and that is stated at the test so nobody reads more into it than it does.
- Adding a method still takes ten places. This ADR does not claim otherwise: it removes the two
  duplicated literals, not the ritual. The ritual is the price of two transports and two
  languages over one contract, it is fully enforced, and none of the ways to shorten it are
  currently worth what they cost.
