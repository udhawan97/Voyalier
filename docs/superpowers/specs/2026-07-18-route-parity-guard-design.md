# Route-parity guard — design

**Date:** 2026-07-18
**Status:** Approved, not yet built
**Closes:** the gap `AGENTS.md` states outright — _"Nothing mechanically catches a Rust-side
route mismatch."_

## The problem

`AppGateway` is one interface implemented across six places. TypeScript enforces three of them
(`contracts/src/index.ts`, `contracts/src/mock.ts`, and both `gateway/*.ts` files are typed
`AppGateway`, so a missing method fails `tsc`). The other three are unchecked:

- `apps/web/src/gateway/tauri.ts` calls `invoke("get_trip", { input })`. The command name is an
  untyped **string**. Rename the Rust command and TypeScript still compiles; the desktop app
  fails at runtime.
- `apps/web/src/gateway/http.ts` calls `request("GET", "/api/v1/trips/…")`. Same problem against
  the `.route()` declarations in `crates/voyalier-server/src/lib.rs` — a renamed path or a
  swapped verb is a 404/405 nobody sees until the app runs.
- `apps/web/src/gateway/gateway.live.test.ts` exists but is `describe.skipIf(!LIVE)` and never
  runs in CI, so it catches nothing today.

## The surface, as measured 2026-07-18

| Surface                               | Count  |
| ------------------------------------- | ------ |
| `AppGateway` methods                  | 57     |
| Axum route handlers                   | 57     |
| Tauri commands invoked by `tauri.ts`  | 57     |
| Tauri commands in `generate_handler!` | **67** |

The 10-command difference is deliberate, not drift. `updater_check`, `updater_install`,
`updater_relaunch`, `backup_database`, `clear_backups`, `export_backup`, `stage_restore`,
`has_pending_restore`, `get_app_setting`, and `set_app_setting` bypass `AppGateway` entirely and
are called from separate bridges (`apps/web/src/updater/tauriUpdater.ts`,
`apps/web/src/backup/tauriBackup.ts`).

For the updater that separation is a stated security property. `docs/architecture/UPDATES.md` and
the roadmap both record it: _"the webview never gets the updater capability — no hidden network
path."_ An `updater_*` route appearing on the loopback HTTP server would silently break that
invariant, and nothing currently watches for it.

## Approach

A shared manifest asserted from both languages, mirroring the existing
`packages/contracts/parity/*.json` idiom. Rejected alternatives:

- **Generate the manifest from the TS gateways.** A golden that regenerates itself cannot catch a
  wrong edit on the side it is generated from, and it makes a client — rather than the contract —
  authoritative.
- **Boot the server in CI and run `gateway.live.test.ts`.** Slow, needs process orchestration,
  gives vague failures, and covers no part of the Tauri surface. Worth adding later as a separate
  end-to-end layer; it does not solve this problem.

## Scope

**In:** command names, HTTP verbs, and HTTP path shape — the whole 404/405 class.

**Out:** payload semantics. Request bodies, query-string contents, and the single-`input`-argument
Tauri convention are not asserted; the parity goldens and serde already cover that ground. The
tests compare **pathname only** and ignore query strings, so `searchTrip`'s `?q=` is invisible to
this guard by design.

## Component 1 — the manifest

`packages/contracts/parity/routes.json`:

```json
{
  "shared": [
    {
      "method": "getTrip",
      "verb": "GET",
      "path": "/api/v1/trips/{tripId}",
      "command": "get_trip"
    },
    {
      "method": "fetchWeather",
      "verb": "POST",
      "path": "/api/v1/trips/{tripId}/weather",
      "command": "fetch_weather"
    }
  ],
  "desktopOnly": ["updater_check", "updater_install", "..."],
  "counts": { "shared": 57, "desktopOnly": 10 }
}
```

`shared` entries carry all four fields. `desktopOnly` entries are bare command names with **no
path** — that absence is what Assertion 5 tests.

`counts` pins both array lengths. It guards the Rust assertions, which have no compiler to lean
on; the TypeScript side gets exhaustiveness for free (see Component 3). Per the existing golden
convention, adding an entry fails until the number is bumped.

Note that `(verb, path)` is the key, not `path` alone — the router chains verbs on a shared path,
e.g. `.route("/api/v1/trips", post(create_trip).get(list_trips))`.

## Component 2 — five assertions

| #   | Claim                                                  | Location                           | Mechanism                                               |
| --- | ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| 1   | `http.ts` emits the manifest's verb + pathname         | `apps/web/src/routeParity.test.ts` | Recording `fetch`, drive all 57 methods                 |
| 2   | `tauri.ts` invokes the manifest's command              | same file                          | Recording `invoke`, drive all 57 methods                |
| 3   | The Axum router serves every `shared` route            | `crates/voyalier-server` tests     | `oneshot` each entry; assert not 404/405                |
| 4   | `generate_handler!` registers every command, both sets | `apps/desktop/src-tauri` tests     | Parse the macro's identifier list from source           |
| 5   | No `desktopOnly` command is reachable over HTTP        | `crates/voyalier-server` tests     | Parse the router's handler identifiers; assert disjoint |

Assertions 1 and 2 exploit the fact that both gateway factories already accept an injectable
transport (`HttpGatewayOptions.fetch`, `TauriGatewayOptions.invoke`), so no server and no Tauri
runtime are needed.

Assertion 3 reuses the `request(router, Method, path, body)` harness that already exists at
`crates/voyalier-server/src/lib.rs:783`, driving the real router through `tower::ServiceExt`. It
asserts only that the route **resolves** — any status other than 404/405 passes, so a handler
rejecting a nonsense body is not a failure.

Assertion 4 is the asymmetric one. `generate_handler!` is a macro with no runtime value to
enumerate, so the test reads the crate's own source (`include_str!("lib.rs")`) and parses the
comma-separated identifier list. This is crude, but a proc-macro or runtime registry is real
machinery for a list that changes a few times a year.

Assertion 5 cannot be driven through the router, because proving a route's **absence** by
requesting it means guessing the URL someone might add. It uses the same source-parsing trick as
Assertion 4 instead: read `crates/voyalier-server/src/lib.rs` via `include_str!`, extract the
handler identifiers from its `.route(…)` calls — the `get(x)` / `post(x)` / `patch(x)` /
`delete(x)` arguments — and assert that set is disjoint from `desktopOnly`. This catches the
regression at its real shape: someone adding an updater or backup handler to the server crate and
wiring it up.

## Component 3 — exhaustiveness without a count on the TS side

Driving 57 methods needs per-method sample arguments. Typing that table as a mapped type makes
the compiler enforce coverage:

```ts
const ARGS: Record<keyof AppGateway, unknown[]> = {
  getTrip: ["trip_1"],
  fetchWeather: ["trip_1"],
  // …
};
```

Adding a method to `AppGateway` breaks the build until it appears here — an earlier and
maintenance-free signal than a number to bump.

Path placeholders resolve through one globally consistent sample map (`tripId` → `"trip_1"`,
`packId` → `"pack_1"`, `documentId` → `"doc_1"`, `factId` → `"fact_1"`), so the manifest's
`/api/v1/trips/{tripId}` renders to `/api/v1/trips/trip_1` and compares against the recorded
call as a concrete string. Recorded URLs are parsed with `new URL(url, "http://localhost")` and
compared on `.pathname`, since `http.ts` emits same-origin relative URLs.

## Failure messages

Each names the surface that drifted, rather than reporting a set difference:

```
routes.json declares fetchWeather → POST /api/v1/trips/{tripId}/weather
  but http.ts issued POST /api/v1/trips/{tripId}/forecast

routes.json declares command `fetch_weather`
  but voyalier-desktop's generate_handler! does not register it

SECURITY: `updater_install` is declared desktop-only in routes.json,
  but crates/voyalier-server routes /api/v1/updater/install to it
```

## CI wiring

No new workflow and no new job. Assertions 1–2 land in the existing web suite, 3 and 5 in
`voyalier-server`, 4 in `voyalier-desktop` — all already invoked by
`scripts/check.sh web|rust|desktop`, which is exactly what the three CI jobs call. Per
`AGENTS.md`: add to the gate, never inline in a workflow.

`voyalier-desktop` sits outside the workspace default members, so Assertion 4 runs only under
`check.sh desktop` (or `make check`), never under a bare `cargo test`.

## Testing

The guard is itself test code, so its verification is mutation-style: each assertion must be
watched failing before it is trusted. For every one of the five, temporarily break the surface it
watches — rename a route, drop a command from `generate_handler!`, add an updater route to the
Axum server — confirm the expected message, then revert. TDD per the repo's convention: the
failing test comes first.

## Consequences

- `routes.json` becomes the reviewable inventory of the API surface — a new gateway method's
  diff now shows the whole six-place change in one file.
- The `AGENTS.md` line stating nothing catches a route mismatch stops being true and needs
  updating when this lands.
- The guard does not remove the need for a real end-to-end layer; `docs/testing/TEST_STRATEGY.md`
  still requires one, and `gateway.live.test.ts` still does not run in CI. This narrows the gap;
  it does not close the strategy item.
