# Route-Parity Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an http/tauri route mismatch against `AppGateway` fail `make check`, closing the gap `AGENTS.md` states outright — _"Nothing mechanically catches a Rust-side route mismatch."_

**Architecture:** One hand-maintained manifest, `packages/contracts/parity/routes.json`, declares every gateway method's HTTP verb, HTTP path, and Tauri command, plus the 10 deliberately desktop-only commands. Five assertions hold the four surfaces to it: two in the web suite (drive both gateways with recording transports), two in `voyalier-server` (probe the real router, and prove desktop-only commands have no route), one in `voyalier-desktop` (parse `generate_handler!`). No new CI job — every assertion lands in a suite `scripts/check.sh` already runs.

**Tech Stack:** Vitest + TypeScript mapped types (web), `tokio` + `tower::ServiceExt` + `serde_json` (Rust), `include_str!` source parsing for the two macro/absence checks.

**Spec:** `docs/superpowers/specs/2026-07-18-route-parity-guard-design.md`

## Global Constraints

- **The manifest is hand-maintained, never generated.** The Task 1 seed script carries a hardcoded literal table; it does not read the gateways. A manifest regenerated from a client could not catch a wrong edit in that client. There is no `VOYALIER_REGENERATE_GOLDEN` path for this file.
- **Scope is names, verbs, and path shape only.** Request bodies, query strings, and the Tauri single-`input`-argument convention are out. Compare **pathname only**.
- **`(verb, path)` is the key, not `path`** — the router chains verbs on shared paths, e.g. `.route("/api/v1/trips", post(create_trip).get(list_trips))`.
- **Counts as measured 2026-07-18:** 57 shared methods, 10 desktop-only commands, 67 registered Tauri commands. All four surfaces were verified identical before this plan was written.
- **The 10 desktop-only commands** are exactly: `backup_database`, `clear_backups`, `export_backup`, `stage_restore`, `has_pending_restore`, `get_app_setting`, `set_app_setting`, `updater_check`, `updater_install`, `updater_relaunch`.
- **Rust errors are `thiserror` only** — no `anyhow`, no `Result` alias (`AGENTS.md`). Test code may `expect()`.
- **Rust tests are inline `#[cfg(test)] mod tests`** — there is no `tests/` directory.
- **Web tests are flat in `apps/web/src/` and named by feature** — hence `routeParity.test.ts`, not `gateway/parity.test.ts`.
- **Commits are `Scope: imperative summary`** with scope a layer (`Contract:`, `Web:`, `App:`, `Desktop:`, `Docs:`, `Test:`), combinable as `Core+app:`. Bodies state the defect, the clause discharged, and how it was verified.
- **Do not add a `check.sh` stage.** The new tests land in suites already invoked by `check.sh web|rust|desktop`.
- **Prettier is enforced** — run `pnpm format:check` (or `--write`) before committing anything under `packages/` or `apps/web/`.

## Why every task ends with a deliberate break

These are conformance tests over code that is already correct, so they pass the moment they are written. A test that has never been seen failing is not yet a test. Every task therefore ends with a **mutation step**: break the surface the assertion watches, confirm the exact failure message, then revert. Do not skip it, and do not commit the mutation.

## File Structure

| File                                              | Responsibility                                                                                                                                                 | Task |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `packages/contracts/parity/routes.json`           | **Create.** The one declaration of the API surface: 57 shared rows + 10 desktop-only commands + pinned counts.                                                 | 1    |
| `apps/web/src/routeParity.test.ts`                | **Create.** Assertions 1–2: drive both gateways with recording transports, compare against the manifest. Owns the `ARGS` table and the placeholder sample map. | 2    |
| `crates/voyalier-server/src/lib.rs` (`mod tests`) | **Modify.** Assertions 3 and 5: probe the real router for every declared route; prove no desktop-only command has one. Adds a `route_probe` helper.            | 3, 4 |
| `apps/desktop/src-tauri/src/lib.rs` (`mod tests`) | **Modify.** Assertion 4: parse `generate_handler!` and hold it to the manifest, both directions.                                                               | 5    |
| `AGENTS.md`                                       | **Modify.** The "nothing catches a route mismatch" line stops being true.                                                                                      | 6    |

`packages/contracts/package.json` already exports `"./parity/*": "./parity/*"`, so no packaging change is needed.

---

### Task 1: The route manifest

**Files:**

- Create: `packages/contracts/parity/routes.json`

**Interfaces:**

- Consumes: nothing.
- Produces: the manifest every later task reads. Shape:
  - `shared: { method: string; verb: "GET"|"POST"|"PATCH"|"DELETE"; path: string; command: string }[]`
  - `desktopOnly: string[]`
  - `counts: { shared: number; desktopOnly: number }`
  - Path placeholders in use: `{tripId}`, `{packId}`, `{documentId}`, `{factId}`, `{candidateId}`, `{provider}`.

- [ ] **Step 1: Write the seed script**

This carries a hardcoded literal table — it does not read the gateways. Save as `scripts/seed-routes-manifest.mjs`; it is deleted in Step 4.

```js
const rows = `health|GET|/api/health|health
createTrip|POST|/api/v1/trips|create_trip
listTrips|GET|/api/v1/trips|list_trips
getTrip|GET|/api/v1/trips/{tripId}|get_trip
updateTrip|PATCH|/api/v1/trips/{tripId}|update_trip
archiveTrip|POST|/api/v1/trips/{tripId}/archive|archive_trip
unarchiveTrip|POST|/api/v1/trips/{tripId}/unarchive|unarchive_trip
getTripBrief|GET|/api/v1/trips/{tripId}/brief|get_trip_brief
getToday|GET|/api/v1/trips/{tripId}/today|get_today
getVaultStatus|GET|/api/v1/vault|get_vault_status
setVaultPassphrase|POST|/api/v1/vault/passphrase|set_vault_passphrase
unlockVault|POST|/api/v1/vault/unlock|unlock_vault
removeVaultPassphrase|POST|/api/v1/vault/remove-passphrase|remove_vault_passphrase
detectLocalAi|GET|/api/v1/local-ai|detect_local_ai
pullLocalModel|POST|/api/v1/local-ai/pull|pull_local_model
listProviders|GET|/api/v1/providers|list_providers
setProviderKey|POST|/api/v1/providers/{provider}/key|set_provider_key
validateProviderKey|POST|/api/v1/providers/{provider}/validate|validate_provider_key
clearProviderKey|DELETE|/api/v1/providers/{provider}/key|clear_provider_key
setProviderModel|POST|/api/v1/providers/{provider}/model|set_provider_model
previewAssist|GET|/api/v1/trips/{tripId}/assist-preview|preview_assist
runAssist|POST|/api/v1/trips/{tripId}/assist|run_assist
previewAssistDraft|GET|/api/v1/trips/{tripId}/assist-draft-preview|preview_assist_draft
runAssistDraft|POST|/api/v1/trips/{tripId}/assist-draft|run_assist_draft
listAssistActivity|GET|/api/v1/trips/{tripId}/assist-activity|list_assist_activity
getAiPrompts|GET|/api/v1/ai/prompts|get_ai_prompts
setAiPrompt|POST|/api/v1/ai/prompts|set_ai_prompt
listPacks|GET|/api/v1/packs|list_packs
suggestPacks|GET|/api/v1/trips/{tripId}/pack-suggestions|suggest_packs
suggestFieldValues|GET|/api/v1/trips/{tripId}/field-suggestions|suggest_field_values
suggestPlaces|GET|/api/v1/places/suggest|suggest_places
downloadPack|POST|/api/v1/trips/{tripId}/packs/{packId}|download_pack
listDownloadedPacks|GET|/api/v1/trips/{tripId}/packs|list_downloaded_packs
deleteDownloadedPack|DELETE|/api/v1/trips/{tripId}/packs/{packId}|delete_downloaded_pack
getOfflineMap|GET|/api/v1/trips/{tripId}/offline-map|get_offline_map
readOfflineMapRange|POST|/api/v1/trips/{tripId}/offline-map/range|read_offline_map_range
getRecommendations|POST|/api/v1/trips/{tripId}/recommendations|get_recommendations
listAdviceCountries|GET|/api/v1/advice/countries|list_advice_countries
fetchAdvisories|POST|/api/v1/trips/{tripId}/advisories|fetch_advisories
fetchWeather|POST|/api/v1/trips/{tripId}/weather|fetch_weather
fetchDestinationFacts|POST|/api/v1/trips/{tripId}/destination-facts|fetch_destination_facts
fetchPublicHolidays|POST|/api/v1/trips/{tripId}/holidays|fetch_public_holidays
fetchPlaceSummary|POST|/api/v1/trips/{tripId}/summary|fetch_place_summary
searchTrip|GET|/api/v1/trips/{tripId}/search|search_trip
suggestSearchTerms|GET|/api/v1/trips/{tripId}/search-suggestions|suggest_search_terms
deleteTrip|DELETE|/api/v1/trips/{tripId}|delete_trip
importDocument|POST|/api/v1/trips/{tripId}/documents|import_document
getTripNotes|GET|/api/v1/trips/{tripId}/notes|get_trip_notes
setTripNotes|POST|/api/v1/trips/{tripId}/notes|set_trip_notes
listDocuments|GET|/api/v1/trips/{tripId}/documents|list_documents
getDocument|GET|/api/v1/documents/{documentId}|get_document
deleteDocument|DELETE|/api/v1/documents/{documentId}|delete_document
listCandidates|GET|/api/v1/trips/{tripId}/candidates|list_candidates
confirmCandidate|POST|/api/v1/candidates/{candidateId}/confirm|confirm_candidate
rejectCandidate|POST|/api/v1/candidates/{candidateId}/reject|reject_candidate
addManualFact|POST|/api/v1/trips/{tripId}/facts|add_manual_fact
unconfirmFact|DELETE|/api/v1/facts/{factId}|unconfirm_fact`
  .split("\n")
  .map((line) => {
    const [method, verb, path, command] = line.split("|");
    return { method, verb, path, command };
  });

const desktopOnly = [
  "backup_database",
  "clear_backups",
  "export_backup",
  "stage_restore",
  "has_pending_restore",
  "get_app_setting",
  "set_app_setting",
  "updater_check",
  "updater_install",
  "updater_relaunch",
];

console.log(
  JSON.stringify(
    {
      shared: rows,
      desktopOnly,
      counts: { shared: rows.length, desktopOnly: desktopOnly.length },
    },
    null,
    2,
  ),
);
```

- [ ] **Step 2: Generate the manifest**

```bash
node scripts/seed-routes-manifest.mjs > packages/contracts/parity/routes.json
pnpm exec prettier --write packages/contracts/parity/routes.json
```

- [ ] **Step 3: Verify the seed against all four surfaces**

This is the one moment the manifest is checked by construction rather than by a committed test. Run all four; every one must print `IDENTICAL` or a zero count.

```bash
# 1. shared methods == AppGateway methods
node -e 'const m=require("./packages/contracts/parity/routes.json");console.log(m.shared.map(r=>r.method).sort().join("\n"))' > /tmp/a.txt
sed -n "/^export interface AppGateway {/,/^}/p" packages/contracts/src/index.ts \
  | grep -oE "^  [a-zA-Z]+\(" | tr -d " (" | sort > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt && echo "1) IDENTICAL"

# 2. shared commands == commands tauri.ts invokes
node -e 'const m=require("./packages/contracts/parity/routes.json");console.log(m.shared.map(r=>r.command).sort().join("\n"))' > /tmp/a.txt
grep -oE '"[a-z_]+"' apps/web/src/gateway/tauri.ts | tr -d '"' | sort -u > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt && echo "2) IDENTICAL"

# 3. shared + desktopOnly == generate_handler! list
node -e 'const m=require("./packages/contracts/parity/routes.json");console.log([...m.shared.map(r=>r.command),...m.desktopOnly].sort().join("\n"))' > /tmp/a.txt
sed -n "$(grep -n 'generate_handler' apps/desktop/src-tauri/src/lib.rs | head -1 | cut -d: -f1),+80p" \
  apps/desktop/src-tauri/src/lib.rs | grep -oE "^ +[a-z_]+,?$" | tr -d " ," | sort -u > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt && echo "3) IDENTICAL"

# 4. shared (verb, path) == Axum routes, both directions
node -e '
const { readFileSync } = require("node:fs");
const src = readFileSync("crates/voyalier-server/src/lib.rs", "utf8");
const found = [];
const re = /\.route\(\s*"([^"]+)"\s*,\s*([\s\S]*?)\)\s*(?=\.route\(|\.fallback|\.layer|\.with_state|;)/g;
let m;
while ((m = re.exec(src))) {
  const vre = /\b(get|post|patch|delete)\(([a-z_]+)\)/g;
  let v;
  while ((v = vre.exec(m[2]))) found.push({ verb: v[1].toUpperCase(), path: m[1] });
}
const norm = (p) => p.replace(/\{trip_id\}/g,"{tripId}").replace(/\{pack_id\}/g,"{packId}")
  .replace(/\{document_id\}/g,"{documentId}").replace(/\{fact_id\}/g,"{factId}")
  .replace(/\{candidate_id\}/g,"{candidateId}");
const rust = new Set(found.map((x) => x.verb + " " + norm(x.path)));
const man = require("./packages/contracts/parity/routes.json").shared;
const manKeys = new Set(man.map((r) => r.verb + " " + r.path));
console.log("rust routes parsed:", found.length);
console.log("declared but not routed:", man.filter((r) => !rust.has(r.verb + " " + r.path)).length);
console.log("routed but not declared:", [...rust].filter((k) => !manKeys.has(k)).length);
'
```

Expected output of check 4:

```
rust routes parsed: 57
declared but not routed: 0
routed but not declared: 0
```

If any check disagrees, **stop** — either the seed table is wrong or a real mismatch already exists in `main`. Investigate before continuing; a manifest seeded from a broken surface would freeze the bug in place.

- [ ] **Step 4: Delete the seed script and commit**

The script has done its one job. Keeping it invites someone to "refresh" the manifest from it later, which is exactly the regeneration this design rejects.

```bash
rm scripts/seed-routes-manifest.mjs
pnpm format:check
git add packages/contracts/parity/routes.json
git commit -m "Contract: declare the route manifest

AppGateway is implemented across six places and TypeScript enforces only
three; tauri.ts invokes command names as untyped strings and http.ts
builds paths as template literals, so a renamed Axum route or Tauri
command still compiles and fails only at runtime.

Adds parity/routes.json as the one declaration of the surface: 57 shared
rows carrying verb, path, and command, plus the 10 desktop-only commands
(updater, backup/restore, settings) that must never gain an HTTP route.
Hand-maintained by design — a manifest regenerated from a client could
not catch a wrong edit in that client.

Verified at seed time against all four surfaces: method names match
AppGateway, commands match tauri.ts invocations, commands plus
desktop-only match generate_handler!, and (verb, path) matches the Axum
router in both directions with 57 routes parsed and zero drift."
```

---

### Task 2: Assertions 1 and 2 — both web gateways

**Files:**

- Create: `apps/web/src/routeParity.test.ts`

**Interfaces:**

- Consumes: `routes.json` from Task 1; `createHttpGateway({ fetch })` from `./gateway/http`; `createTauriGateway({ invoke })` from `./gateway/tauri`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

```ts
import routes from "@voyalier/contracts/parity/routes.json";
import type { AppGateway } from "@voyalier/contracts";

import { createHttpGateway } from "./gateway/http";
import { createTauriGateway } from "./gateway/tauri";

/**
 * `packages/contracts/parity/routes.json` is the one declaration of the API
 * surface. This holds the two web gateways to it; voyalier-server's
 * `every_declared_route_is_served_by_the_router` and voyalier-desktop's
 * `generate_handler_registers_every_declared_command` hold the Rust side.
 *
 * tauri.ts invokes command names as untyped strings and http.ts builds paths
 * as template literals, so before this existed a renamed route or command
 * still compiled and failed only when the app ran.
 */
interface SharedRoute {
  method: string;
  verb: string;
  path: string;
  command: string;
}

const SHARED = routes.shared as SharedRoute[];

/** One sample value per path placeholder, shared by every row. */
const SAMPLES: Record<string, string> = {
  tripId: "trip_1",
  packId: "pack_1",
  documentId: "doc_1",
  factId: "fact_1",
  candidateId: "cand_1",
  provider: "openai",
};

function resolvePath(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const sample = SAMPLES[name];
    if (sample === undefined) {
      throw new Error(
        `parity/routes.json uses the placeholder {${name}}, which has no sample value in SAMPLES`,
      );
    }
    return sample;
  });
}

/**
 * Arguments for every gateway method. The mapped type is the point: adding a
 * method to AppGateway fails the build here until it is listed, so coverage
 * needs no count to bump. Values matter only where they reach the URL.
 */
const ARGS: Record<keyof AppGateway, unknown[]> = {
  health: [],
  createTrip: [{}],
  listTrips: [],
  getTrip: ["trip_1"],
  updateTrip: ["trip_1", {}],
  archiveTrip: ["trip_1"],
  unarchiveTrip: ["trip_1"],
  getTripBrief: ["trip_1"],
  getToday: ["trip_1"],
  getVaultStatus: [],
  setVaultPassphrase: ["pw"],
  unlockVault: ["pw"],
  removeVaultPassphrase: ["pw"],
  detectLocalAi: [],
  pullLocalModel: ["llama3"],
  listProviders: [],
  setProviderKey: [{ provider: "openai", key: "k" }],
  validateProviderKey: [{ provider: "openai", key: "k" }],
  clearProviderKey: ["openai"],
  setProviderModel: [{ provider: "openai", model: "gpt-4" }],
  previewAssist: ["trip_1", "openai"],
  runAssist: ["trip_1", "openai"],
  previewAssistDraft: ["trip_1", "packing"],
  runAssistDraft: ["trip_1", "packing"],
  listAssistActivity: ["trip_1"],
  getAiPrompts: [],
  setAiPrompt: ["assist", "text"],
  listPacks: [],
  suggestPacks: ["trip_1"],
  suggestFieldValues: [{ tripId: "trip_1", field: "origin", query: "q" }],
  suggestPlaces: ["q"],
  downloadPack: ["trip_1", "pack_1"],
  listDownloadedPacks: ["trip_1"],
  deleteDownloadedPack: ["trip_1", "pack_1"],
  getOfflineMap: ["trip_1"],
  readOfflineMapRange: ["trip_1", "pack_1", 0, 1],
  getRecommendations: ["trip_1", {}],
  listAdviceCountries: [],
  fetchAdvisories: [{ tripId: "trip_1", countrySlug: "japan" }],
  fetchWeather: ["trip_1"],
  fetchDestinationFacts: ["trip_1"],
  fetchPublicHolidays: ["trip_1"],
  fetchPlaceSummary: ["trip_1"],
  searchTrip: ["trip_1", "q"],
  suggestSearchTerms: ["trip_1", "q"],
  deleteTrip: ["trip_1"],
  importDocument: [{ tripId: "trip_1" }],
  getTripNotes: ["trip_1"],
  setTripNotes: ["trip_1", "body"],
  listDocuments: ["trip_1"],
  getDocument: ["doc_1"],
  deleteDocument: ["doc_1"],
  listCandidates: ["trip_1"],
  confirmCandidate: [{ candidateId: "cand_1" }],
  rejectCandidate: ["cand_1"],
  addManualFact: [{ tripId: "trip_1" }],
  unconfirmFact: ["fact_1"],
};

async function drive(gateway: AppGateway, method: string): Promise<void> {
  const fn = gateway[method as keyof AppGateway] as (
    ...args: unknown[]
  ) => Promise<unknown>;
  // Transports are fakes; a rejection is fine. Only the call is being observed.
  await fn(...ARGS[method as keyof AppGateway]).catch(() => undefined);
}

describe("route parity: the manifest covers the whole gateway", () => {
  it("declares exactly the methods ARGS covers", () => {
    // ARGS is compiler-forced to equal AppGateway, so this transitively holds
    // routes.json to AppGateway — no count to bump on the TypeScript side.
    expect(SHARED.map((route) => route.method).sort()).toEqual(
      Object.keys(ARGS).sort(),
    );
  });

  it("pins the declared counts", () => {
    expect(SHARED.length).toBe(routes.counts.shared);
    expect(routes.desktopOnly.length).toBe(routes.counts.desktopOnly);
  });
});

describe("route parity: http.ts against the manifest", () => {
  it.each(SHARED)("$method → $verb $path", async (route) => {
    const calls: { verb: string; pathname: string }[] = [];
    const recordingFetch = ((url: string, init?: RequestInit) => {
      calls.push({
        verb: String(init?.method ?? "GET"),
        pathname: new URL(url, "http://localhost").pathname,
      });
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await drive(createHttpGateway({ fetch: recordingFetch }), route.method);

    expect(calls).toHaveLength(1);
    expect(`${calls[0].verb} ${calls[0].pathname}`).toBe(
      `${route.verb} ${resolvePath(route.path)}`,
    );
  });
});

describe("route parity: tauri.ts against the manifest", () => {
  it.each(SHARED)("$method → $command", async (route) => {
    const invoked: string[] = [];
    const recordingInvoke = <T>(command: string): Promise<T> => {
      invoked.push(command);
      return Promise.resolve(undefined as T);
    };

    await drive(createTauriGateway({ invoke: recordingInvoke }), route.method);

    expect(invoked).toEqual([route.command]);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @voyalier/web test routeParity
```

Expected: PASS, 116 tests (2 coverage + 57 http + 57 tauri). They pass immediately — the surfaces are correct today. Step 4 is what proves the assertions actually bite.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. If `ARGS` reports a missing or excess key, the mapped type is doing its job — reconcile against `AppGateway`.

- [ ] **Step 4: Mutation check — break each surface, watch it fail, revert**

Break 4a. In `apps/web/src/gateway/http.ts`, change `fetchWeather`'s path from `/weather` to `/forecast`. Run `pnpm --filter @voyalier/web test routeParity`.

Expected: `fetchWeather → POST /api/v1/trips/{tripId}/weather` fails with the received string showing `POST /api/v1/trips/trip_1/forecast`. **Revert.**

Break 4b. In `apps/web/src/gateway/tauri.ts`, change `fetchWeather`'s command from `"fetch_weather"` to `"fetch_forecast"`. Run the same command.

Expected: `fetchWeather → fetch_weather` fails, received `["fetch_forecast"]`. **Revert.**

Break 4c. In `packages/contracts/parity/routes.json`, delete the `unconfirmFact` row (and leave `counts.shared` at 57). Run the same command.

Expected: two failures — `declares exactly the methods ARGS covers` and `pins the declared counts`. **Revert**, then confirm the suite is green again.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add apps/web/src/routeParity.test.ts
git commit -m "Web: hold both gateways to the route manifest

http.ts and tauri.ts were the two unchecked implementations of
AppGateway — TypeScript types their method set but not the path strings
or the invoke command names, so a rename compiled clean and 404'd at
runtime.

Drives all 57 methods through both gateways with recording fetch/invoke
transports and compares verb, pathname, and command against
parity/routes.json. The ARGS table is typed Record<keyof AppGateway,
unknown[]>, so a new gateway method fails the build here until listed;
a second assertion holds routes.json to ARGS, which transitively holds
the manifest to AppGateway with no count to maintain.

Verified by mutation: renaming fetchWeather's path, renaming its
command, and deleting a manifest row each produced the expected
failure before being reverted."
```

---

### Task 3: Assertion 3 — every declared route is served

**Files:**

- Modify: `crates/voyalier-server/src/lib.rs` — add to the existing `#[cfg(test)] mod tests` (starts line 774)

**Interfaces:**

- Consumes: `routes.json`; the existing `temp_database`, `open_test_service`, and `app` helpers in that module.
- Produces: `RouteManifest`, `SharedRoute`, `ManifestCounts`, `load_route_manifest()`, `resolve_path()`, and `route_probe()` — Task 4 reuses `load_route_manifest` and the manifest types.

**Why not reuse the existing `request` helper:** it does `serde_json::from_slice(&body).expect("json response")`, and Axum's own extractor rejections (empty body against a `Json<T>` handler) answer in **plain text**, which would panic. The probe below never parses a body.

**Why body-emptiness matters:** Axum answers an unmatched route with 404 **and an empty body**, while a handler answers "trip not found" with 404 **and an `AppError` JSON body**. Only the first is a routing failure.

- [ ] **Step 1: Write the test**

Add inside `mod tests`:

```rust
/// Only the fields this crate asserts on. serde ignores the rest, so the
/// `command` column is deliberately absent — declaring it here would be dead
/// code under `clippy -D warnings`.
#[derive(serde::Deserialize)]
struct SharedRoute {
    method: String,
    verb: String,
    path: String,
}

#[derive(serde::Deserialize)]
struct ManifestCounts {
    shared: usize,
    #[serde(rename = "desktopOnly")]
    desktop_only: usize,
}

#[derive(serde::Deserialize)]
struct RouteManifest {
    shared: Vec<SharedRoute>,
    #[serde(rename = "desktopOnly")]
    desktop_only: Vec<String>,
    counts: ManifestCounts,
}

/// `packages/contracts/parity/routes.json` is the one declaration of the API
/// surface. `apps/web/src/routeParity.test.ts` holds the two web gateways to
/// the same file.
fn load_route_manifest() -> RouteManifest {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/routes.json");
    let raw = fs::read_to_string(&path).expect("parity/routes.json");
    serde_json::from_str(&raw).expect("parity/routes.json parses")
}

/// Substitute the manifest's path placeholders with the same sample values
/// `routeParity.test.ts` uses, so both sides probe identical URLs.
fn resolve_path(path: &str) -> String {
    path.replace("{tripId}", "trip_1")
        .replace("{packId}", "pack_1")
        .replace("{documentId}", "doc_1")
        .replace("{factId}", "fact_1")
        .replace("{candidateId}", "cand_1")
        .replace("{provider}", "openai")
}

/// A routing probe: status plus whether the body was empty, and deliberately
/// no body parsing. `request` would panic here, because Axum's extractor
/// rejections to an empty body answer in plain text rather than AppError JSON.
async fn route_probe(router: Router, method: Method, uri: &str) -> (StatusCode, bool) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "127.0.0.1:8787")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .expect("request");
    let response = router.oneshot(request).await.expect("response");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("bytes");
    (status, body.is_empty())
}

#[tokio::test]
async fn every_declared_route_is_served_by_the_router() {
    let manifest = load_route_manifest();
    assert_eq!(
        manifest.shared.len(),
        manifest.counts.shared,
        "parity/routes.json declares counts.shared = {} but carries {} rows",
        manifest.counts.shared,
        manifest.shared.len()
    );

    let database = temp_database("route_parity");
    let service = open_test_service(&database).expect("service");
    let router = app(service);

    for route in &manifest.shared {
        let uri = resolve_path(&route.path);
        assert!(
            !uri.contains('{'),
            "parity/routes.json path {} has a placeholder with no sample value in resolve_path",
            route.path
        );
        let method = Method::from_bytes(route.verb.as_bytes())
            .unwrap_or_else(|_| panic!("parity/routes.json verb {} is not a method", route.verb));

        let (status, body_empty) = route_probe(router.clone(), method, &uri).await;

        // An unmatched route is 404 with an empty body; a handler saying
        // "trip not found" is 404 with an AppError body. Only the first is
        // a routing failure. A verb mismatch on a matched path is 405.
        assert!(
            !(status == StatusCode::NOT_FOUND && body_empty),
            "parity/routes.json declares {} -> {} {} but the Axum router has no such route \
             (404, empty body). Add it in crates/voyalier-server, or fix the manifest.",
            route.method,
            route.verb,
            route.path
        );
        assert_ne!(
            status,
            StatusCode::METHOD_NOT_ALLOWED,
            "parity/routes.json declares {} -> {} {} but the Axum router serves that path \
             under a different verb (405).",
            route.method,
            route.verb,
            route.path
        );
    }
}
```

If `Path`, `fs`, `header`, `Body`, `Request`, `to_bytes`, `Method`, `Router`, or `StatusCode` are not already in scope in `mod tests`, add the imports — the module already uses `std::{fs, path::PathBuf}`, `axum::body::to_bytes`, and `tower::ServiceExt`, and the rest come through `use super::*`.

- [ ] **Step 2: Run the test**

```bash
cargo test -p voyalier-server every_declared_route_is_served_by_the_router
```

Expected: PASS. All 57 routes resolve today.

- [ ] **Step 3: Mutation check**

Break 3a. In the router builder, change `.route("/api/v1/trips/{trip_id}/weather", post(fetch_weather))` to `.../forecast`. Re-run.

Expected: failure naming `fetchWeather -> POST /api/v1/trips/{tripId}/weather` and "no such route (404, empty body)". **Revert.**

Break 3b. Change that same route's verb from `post(fetch_weather)` to `get(fetch_weather)`. Re-run.

Expected: the 405 assertion fires. **Revert**, re-run, confirm green.

- [ ] **Step 4: Commit**

```bash
cargo fmt --all
git add crates/voyalier-server/src/lib.rs
git commit -m "App: probe every declared route against the real router

Nothing held the Axum router to AppGateway: http.ts builds paths as
template literals, so a renamed route or a swapped verb compiled clean
on both sides and surfaced as a 404 only when the app ran.

Drives the real router through tower::ServiceExt once per manifest row.
Distinguishes a routing miss (404 with an empty body, which Axum emits
for an unmatched path) from a handler's own 404 (an AppError body), so
probing with a throwaway trip id is safe; a matched path under the
wrong verb surfaces as 405. Adds route_probe rather than reusing the
existing request helper, which parses every body and would panic on
Axum's plain-text extractor rejections.

Verified by mutation: renaming the weather route and swapping its verb
each produced the expected failure before being reverted."
```

---

### Task 4: Assertion 5 — desktop-only commands stay off HTTP

**Files:**

- Modify: `crates/voyalier-server/src/lib.rs` — same `mod tests`

**Interfaces:**

- Consumes: `load_route_manifest()` from Task 3.
- Produces: nothing consumed later.

This is an absence proof, and absence cannot be probed by requesting a URL — that would mean guessing the path someone might add. It reads the crate's own source instead.

- [ ] **Step 1: Write the test**

```rust
/// Every identifier the router hands to a method filter — the `x` in `get(x)`,
/// `post(x)`, `patch(x)`, `delete(x)`. Deliberately greedy: it scans the whole
/// file rather than only `.route(...)` blocks, because for a disjointness
/// check over-collecting is the safe direction.
fn router_handler_names(source: &str) -> std::collections::HashSet<&str> {
    let mut names = std::collections::HashSet::new();
    for verb in ["get(", "post(", "patch(", "delete("] {
        let mut rest = source;
        while let Some(index) = rest.find(verb) {
            let after = &rest[index + verb.len()..];
            let end = after
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .unwrap_or(after.len());
            if end > 0 && after[end..].starts_with(')') {
                names.insert(&after[..end]);
            }
            rest = after;
        }
    }
    names
}

/// The updater, backup/restore, and settings commands are reachable only over
/// Tauri IPC. For the updater that separation is a stated security property
/// (docs/architecture/UPDATES.md: the webview holds no network path to it), so
/// an HTTP route to one of these is a regression, not a feature.
#[test]
fn desktop_only_commands_never_gain_an_http_route() {
    let manifest = load_route_manifest();
    assert_eq!(
        manifest.desktop_only.len(),
        manifest.counts.desktop_only,
        "parity/routes.json declares counts.desktopOnly = {} but carries {} entries",
        manifest.counts.desktop_only,
        manifest.desktop_only.len()
    );

    let handlers = router_handler_names(include_str!("lib.rs"));
    for command in &manifest.desktop_only {
        assert!(
            !handlers.contains(command.as_str()),
            "SECURITY: `{command}` is declared desktop-only in parity/routes.json, but \
             crates/voyalier-server routes a request to a handler of that name. The updater, \
             backup/restore, and settings commands must stay off the loopback HTTP surface \
             (docs/architecture/UPDATES.md). Remove the route, or move the command out of \
             desktopOnly with an ADR."
        );
    }
}
```

- [ ] **Step 2: Run the test**

```bash
cargo test -p voyalier-server desktop_only_commands_never_gain_an_http_route
```

Expected: PASS.

- [ ] **Step 3: Mutation check**

Add a real handler and route to `crates/voyalier-server/src/lib.rs`:

```rust
async fn updater_install() -> StatusCode {
    StatusCode::NO_CONTENT
}
```

and wire it: `.route("/api/v1/updater/install", post(updater_install))`. Re-run.

Expected: failure beginning `SECURITY: \`updater_install\` is declared desktop-only`. **Revert both edits**, re-run, confirm green.

- [ ] **Step 4: Commit**

```bash
cargo fmt --all
cargo clippy --locked -p voyalier-server --all-targets -- -D warnings
git add crates/voyalier-server/src/lib.rs
git commit -m "App: prove desktop-only commands have no HTTP route

UPDATES.md records that the webview holds no network path to the
updater, and backup/restore and settings are Tauri-only for the same
reason. Nothing enforced it: adding an updater route to the loopback
server would have broken the property silently, since absence
invariants fail no test while they hold.

Parses the crate's own source for the identifiers handed to get/post/
patch/delete and asserts that set is disjoint from the manifest's
desktopOnly list. Source parsing rather than a request probe because
proving a route's absence by asking for it means guessing the URL
someone might add.

Verified by mutation: adding a real POST /api/v1/updater/install route
produced the SECURITY failure before being reverted."
```

---

### Task 5: Assertion 4 — `generate_handler!` registration

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs` — add to the existing `#[cfg(test)] mod tests` (starts line 1023)

**Interfaces:**

- Consumes: `routes.json`. Redeclares the manifest types locally — this is a different crate and the server's test module is not importable.
- Produces: nothing consumed later.

Note the path depth differs from Task 3: `CARGO_MANIFEST_DIR` here is `apps/desktop/src-tauri`, so the manifest is three levels up, not two.

- [ ] **Step 1: Write the test**

```rust
#[derive(serde::Deserialize)]
struct SharedRoute {
    method: String,
    command: String,
}

#[derive(serde::Deserialize)]
struct ManifestCounts {
    shared: usize,
    #[serde(rename = "desktopOnly")]
    desktop_only: usize,
}

#[derive(serde::Deserialize)]
struct RouteManifest {
    shared: Vec<SharedRoute>,
    #[serde(rename = "desktopOnly")]
    desktop_only: Vec<String>,
    counts: ManifestCounts,
}

fn load_route_manifest() -> RouteManifest {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/contracts/parity/routes.json");
    let raw = std::fs::read_to_string(&path).expect("parity/routes.json");
    serde_json::from_str(&raw).expect("parity/routes.json parses")
}

/// The identifiers inside `tauri::generate_handler![...]`. The macro leaves no
/// runtime value to enumerate, so the list is read out of the source. A
/// proc-macro or a registry would be real machinery for a list that changes a
/// few times a year.
fn registered_commands(source: &str) -> Vec<&str> {
    let marker = "generate_handler![";
    let start = source
        .find(marker)
        .expect("generate_handler! block in lib.rs");
    let after = &source[start + marker.len()..];
    let end = after.find(']').expect("generate_handler! closing bracket");
    after[..end]
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .flat_map(|line| line.split(','))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .collect()
}

/// `packages/contracts/parity/routes.json` is the one declaration of the API
/// surface. tauri.ts invokes these names as untyped strings, so without this
/// a renamed or dropped command compiled clean and failed at runtime.
#[test]
fn generate_handler_registers_every_declared_command() {
    let manifest = load_route_manifest();
    let registered = registered_commands(include_str!("lib.rs"));

    for route in &manifest.shared {
        assert!(
            registered.contains(&route.command.as_str()),
            "parity/routes.json declares command `{}` for {}, but voyalier-desktop's \
             generate_handler! does not register it",
            route.command,
            route.method
        );
    }

    for command in &manifest.desktop_only {
        assert!(
            registered.contains(&command.as_str()),
            "parity/routes.json declares desktop-only command `{command}`, but \
             voyalier-desktop's generate_handler! does not register it"
        );
    }

    // Catches the other direction: a command the manifest does not describe.
    assert_eq!(
        registered.len(),
        manifest.counts.shared + manifest.counts.desktop_only,
        "generate_handler! registers {} commands but parity/routes.json declares {} \
         ({} shared + {} desktop-only). Every Tauri command must appear in the manifest, \
         as a shared row or a desktopOnly entry.",
        registered.len(),
        manifest.counts.shared + manifest.counts.desktop_only,
        manifest.counts.shared,
        manifest.counts.desktop_only
    );
}
```

- [ ] **Step 2: Run the test**

```bash
cargo test -p voyalier-desktop generate_handler_registers_every_declared_command
```

Expected: PASS — 67 registered, 57 + 10 declared.

Note `voyalier-desktop` is outside the workspace default members, so a bare `cargo test` skips it. It runs under `./scripts/check.sh desktop` and `make check`.

- [ ] **Step 3: Mutation check**

Break 5a. Delete `fetch_weather,` from the `generate_handler!` list. Re-run.

Expected: `parity/routes.json declares command \`fetch_weather\` for fetchWeather, but voyalier-desktop's generate_handler! does not register it`, plus the count mismatch. **Revert.**

Break 5b. Delete `updater_install,` from the list. Re-run.

Expected: the desktop-only branch fires. **Revert**, re-run, confirm green.

- [ ] **Step 4: Commit**

```bash
cargo fmt --all
cargo clippy --locked -p voyalier-desktop --all-targets -- -D warnings
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "Desktop: hold generate_handler! to the route manifest

tauri.ts invokes command names as untyped strings, so dropping or
renaming a command in generate_handler! compiled clean on both sides
and failed only when the desktop app ran.

Parses the macro's identifier list out of the crate's own source and
asserts it covers every manifest command, shared and desktop-only, then
pins the total at 67 so a command the manifest does not describe fails
too. Source parsing because generate_handler! leaves no runtime value
to enumerate.

Verified by mutation: dropping fetch_weather and dropping
updater_install each produced the expected failure before being
reverted."
```

---

### Task 6: Correct the agent contract

**Files:**

- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the four assertions from Tasks 2–5.
- Produces: nothing.

`AGENTS.md` currently tells every agent that nothing catches a route mismatch. That stops being true here, and a stale contract file is worse than none — it will talk the next contributor out of trusting a guard that works.

- [ ] **Step 1: Update the parity section**

In the "Contracts and parity" section, the current text reads:

> `AppGateway` is the one interface; a new method must land in every one of: `AppService`, the Axum route, the Tauri command, `contracts/src/index.ts`, `contracts/src/mock.ts`, and both `gateway/http.ts` and `gateway/tauri.ts`. TypeScript catches the last three; nothing catches a Rust-side route mismatch.

Replace the final sentence so it reads:

> TypeScript catches the last three, and `packages/contracts/parity/routes.json` catches the transports: it declares each method's HTTP verb, HTTP path, and Tauri command, and is asserted from `apps/web/src/routeParity.test.ts` (both gateways), `voyalier-server` (every declared route resolves; no desktop-only command has a route), and `voyalier-desktop` (`generate_handler!` registers every command). Add a gateway method and all four fail until the manifest is updated. It is hand-maintained — never regenerate it from a gateway.

- [ ] **Step 2: Update the testing section**

The current text reads:

> There is no e2e layer yet despite `docs/testing/TEST_STRATEGY.md` requiring one, and `gateway.live.test.ts` never runs in CI. Nothing mechanically catches an http/tauri route mismatch.

Replace the last sentence:

> Route names, verbs, and path shapes are now caught by the `parity/routes.json` guard; what remains uncovered is serialization — a route that resolves but whose payload the other side cannot parse.

- [ ] **Step 3: Verify the claims are true**

Do not commit a contract file describing tests that do not pass.

```bash
./scripts/check.sh
```

Expected: all three stages green.

- [ ] **Step 4: Commit**

```bash
pnpm format:check
git add AGENTS.md
git commit -m "Docs: record that route parity is now enforced

AGENTS.md told every agent that nothing mechanically catches an
http/tauri route mismatch, which the parity/routes.json guard makes
false. A stale contract file is worse than none: it would talk the next
contributor out of trusting a guard that works, and out of updating the
manifest when adding a method.

Narrows the remaining gap to what is actually still open — a route that
resolves but whose payload the other side cannot parse — and keeps the
e2e item, which routes.json does not discharge.

Verified with ./scripts/check.sh: all three stages green."
```

---

## Verification

The whole gate, exactly as CI runs it:

```bash
make check
```

Expected: green across web, rust, and desktop. Confirm the new tests actually ran:

```bash
pnpm --filter @voyalier/web test routeParity        # 116 passing
cargo test -p voyalier-server route                  # 2 passing
cargo test -p voyalier-desktop generate_handler      # 1 passing
```

## Out of scope

- **Payload parity.** A route that resolves but whose body the other side cannot deserialize still passes. That needs the e2e layer `docs/testing/TEST_STRATEGY.md` asks for.
- **Running `gateway.live.test.ts` in CI.** Still `skipIf`-gated; unchanged here.
- **`AppService` method coverage.** The manifest describes transports. A gateway method missing from `AppService` fails to compile in both shells already.
