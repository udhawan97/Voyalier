import routes from "@voyalier/contracts/parity/routes.json";
import type { AppGateway } from "@voyalier/contracts";

import { createTauriBackup } from "./backup/tauriBackup";
import { createHttpGateway } from "./gateway/http";
import { createTauriGateway } from "./gateway/tauri";
import { createTauriUpdater } from "./updater/tauriUpdater";

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
/**
 * What a gateway puts on the wire.
 *
 * - a literal list — the gateway writes those keys itself
 * - `"input"` — a whole typed object is forwarded, and the Rust side reads the
 *   shared `voyalier-core` type, so there are no key names to compare here
 * - `{ whole: [...] }` — forwarded whole, but the Rust side re-declares the
 *   fields locally, so both the forward and the exact key set are checkable.
 *   Five methods are in this shape and nothing had noticed.
 */
type PayloadKeys = string[] | "input" | { whole: string[] };

interface SharedRoute {
  method: string;
  verb: string;
  path: string;
  command: string;
  /** What goes on the wire, per ADR-0012. `"input"` is a whole forwarded object. */
  payload: {
    command: PayloadKeys;
    body: PayloadKeys | null;
    query: string[];
  };
}

const SHARED = routes.shared as SharedRoute[];

/** One sample value per path placeholder, shared by every row. */
const SAMPLES: Record<string, string> = {
  tripId: "trip_1",
  packId: "pack_1",
  documentId: "doc_1",
  // A curated visa document id, which is not an imported source document id.
  visaDocumentId: "ca.trv.funds.statements",
  factId: "fact_1",
  candidateId: "cand_1",
  provider: "openai",
  savedPlaceId: "place_1",
  packingItemId: "packing_1",
  tripItemId: "item_1",
  resourceId: "res_1",
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
 * needs no count to bump.
 *
 * Values used to matter only where they reached the URL. Since ADR-0012 they
 * also carry the payload: the suites below record the keys each gateway puts on
 * the wire and hold them to `payload` in the manifest, so an object argument
 * here has to look like the real thing. `SENTINEL` marks the objects a gateway
 * is supposed to forward whole — if one arrives reshaped or replaced, the key
 * is missing and the assertion says so.
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
  setInterestProfile: [{ tripId: "trip_1" }],
  getVisaPrep: ["trip_1"],
  setVisaNationality: [{ tripId: "trip_1", nationalityIso2: "IN" }],
  setVisaItemProgress: [
    { tripId: "trip_1", documentId: "ca.trv.funds.statements", checked: true },
  ],
  refreshVisaStats: ["trip_1"],
  savePlace: [{ tripId: "trip_1", recommendation: {} }],
  updateSavedPlace: [{ savedPlaceId: "place_1", notes: "" }],
  deleteSavedPlace: ["place_1"],
  addPackingItem: [{ tripId: "trip_1", label: "item" }],
  updatePackingItem: [
    { packingItemId: "packing_1", label: "item", checked: false },
  ],
  deletePackingItem: ["packing_1"],
  createTripItem: [{ tripId: "trip_1", kind: "activity", title: "item" }],
  updateTripItem: [{ tripItemId: "item_1", kind: "activity", title: "item" }],
  deleteTripItem: ["item_1"],
  listAdviceCountries: [],
  fetchAdvisories: [{ tripId: "trip_1", countrySlug: "japan" }],
  fetchWeather: ["trip_1"],
  recheckTrip: ["trip_1"],
  fetchDestinationFacts: ["trip_1"],
  fetchPublicHolidays: ["trip_1"],
  fetchPlaceSummary: ["trip_1"],
  listResources: ["trip_1"],
  createResource: [
    { tripId: "trip_1", kind: "link", url: "https://a.example" },
  ],
  updateResource: [{ resourceId: "res_1", title: "t" }],
  deleteResource: ["res_1"],
  fetchResourceDetails: ["res_1"],
  getResearchSettings: [],
  setResearchSettings: [{ autoFetchDetails: true }],
  listChatMessages: ["trip_1"],
  sendChatMessage: ["trip_1", "hello"],
  clearChat: ["trip_1"],
  searchTrip: ["trip_1", "q"],
  searchWorkspace: ["q"],
  suggestSearchTerms: ["trip_1", "q"],
  deleteTrip: ["trip_1"],
  importDocument: [{ tripId: "trip_1" }],
  getTripNotes: ["trip_1"],
  setTripNotes: ["trip_1", "body"],
  listDocuments: ["trip_1"],
  getDocument: ["doc_1"],
  deleteDocument: ["doc_1"],
  // The status makes the optional branch of the only conditional argument
  // shape in either gateway observable.
  listCandidates: ["trip_1", "pending"],
  confirmCandidate: [{ candidateId: "cand_1" }],
  rejectCandidate: ["cand_1"],
  addManualFact: [{ tripId: "trip_1" }],
  unconfirmFact: ["fact_1"],
};

/**
 * Marks an object argument so a whole-object forward can be told from a
 * hand-built one. A gateway that forwards `input` carries this key onto the
 * wire; a gateway that picks named keys out of it cannot.
 */
const SENTINEL = "__forwardedWhole";

function withSentinel(args: unknown[]): unknown[] {
  return args.map((arg) =>
    arg !== null && typeof arg === "object" && !Array.isArray(arg)
      ? { ...(arg as Record<string, unknown>), [SENTINEL]: true }
      : arg,
  );
}

async function drive(gateway: AppGateway, method: string): Promise<void> {
  const fn = gateway[method as keyof AppGateway] as (
    ...args: unknown[]
  ) => Promise<unknown>;
  // Transports are fakes; a rejection is fine. Only the call is being observed.
  await fn(...withSentinel(ARGS[method as keyof AppGateway])).catch(
    () => undefined,
  );
}

/**
 * Hold one set of wire keys to what `payload` in the manifest declares.
 *
 * `"input"` means the gateway forwards a whole typed object: the sentinel must
 * survive, which is what distinguishes forwarding from reshaping. A literal
 * list means the gateway writes those keys itself, so the set must match
 * exactly and the sentinel must NOT appear — its presence would mean the whole
 * input leaked onto the wire alongside them.
 */
function expectPayload(
  actual: string[],
  declared: PayloadKeys | null,
  what: string,
) {
  if (declared === null) {
    expect(actual, `${what}: the manifest declares no payload`).toEqual([]);
    return;
  }
  if (declared === "input") {
    expect(actual, `${what}: the whole object should be forwarded`).toContain(
      SENTINEL,
    );
    return;
  }
  if (Array.isArray(declared)) {
    expect(actual.includes(SENTINEL), `${what}: leaked the whole input`).toBe(
      false,
    );
    expect([...actual].sort(), `${what}: wire keys`).toEqual(
      [...declared].sort(),
    );
    return;
  }
  // Forwarded whole AND re-declared on the Rust side: both facts are checked.
  expect(actual, `${what}: the whole object should be forwarded`).toContain(
    SENTINEL,
  );
  expect(
    actual.filter((key) => key !== SENTINEL).sort(),
    `${what}: wire keys`,
  ).toEqual([...declared.whole].sort());
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

/**
 * Since ADR-0011 these two suites are weaker than they read.
 *
 * They used to compare a literal in the gateway against the manifest. The
 * gateways now derive verb, path, and command from the manifest, so this
 * compares a derivation against its own source — close to tautological on the
 * happy path.
 *
 * They are kept because they still catch what a derivation can get wrong: a
 * placeholder bound to the wrong argument name (`route` throws), a method
 * pointed at the wrong manifest row, and a call that fires twice or not at all.
 * What they no longer carry is proof that the paths are the ones the server
 * serves — `the_router_declares_exactly_the_manifest` in voyalier-server and
 * `generate_handler_registers_every_declared_command` in voyalier-desktop hold
 * that end, in both directions, and `gateway.live.test.ts` drives the real one.
 */
describe("route parity: http.ts against the manifest", () => {
  it.each(SHARED)("$method → $verb $path", async (route) => {
    const calls: {
      verb: string;
      pathname: string;
      body: string[];
      query: string[];
    }[] = [];
    const recordingFetch = ((url: string, init?: RequestInit) => {
      const parsed = new URL(url, "http://localhost");
      calls.push({
        verb: String(init?.method ?? "GET"),
        pathname: parsed.pathname,
        // The body and the query string used to be thrown away here, which is
        // how a renamed body key stayed invisible to every guard (ADR-0012).
        body:
          typeof init?.body === "string"
            ? Object.keys(JSON.parse(init.body) as Record<string, unknown>)
            : [],
        query: [...parsed.searchParams.keys()],
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
    expectPayload(calls[0].body, route.payload.body, `${route.method} body`);
    expectPayload(calls[0].query, route.payload.query, `${route.method} query`);
  });
});

describe("route parity: tauri.ts against the manifest", () => {
  it.each(SHARED)("$method → $command", async (route) => {
    const invoked: string[] = [];
    const envelopes: string[][] = [];
    // The second parameter was declared away, so the argument object -- the
    // thing 56 of these calls hand-build by name -- reached no assertion.
    const recordingInvoke = <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      invoked.push(command);
      const input = args?.input;
      envelopes.push(
        input !== null && typeof input === "object"
          ? Object.keys(input as Record<string, unknown>)
          : [],
      );
      return Promise.resolve(undefined as T);
    };

    await drive(createTauriGateway({ invoke: recordingInvoke }), route.method);

    expect(invoked).toEqual([route.command]);
    expectPayload(
      envelopes[0],
      route.payload.command,
      `${route.method} command argument`,
    );
  });
});

/**
 * The desktop-only commands never reach AppGateway, so the blocks above cannot
 * see them: `updater/tauriUpdater.ts` and `backup/tauriBackup.ts` invoke them
 * directly, as untyped strings. voyalier-desktop holds `generate_handler!` to
 * `desktopOnly`, which left one hole — rename a command in the Rust wrapper, in
 * `generate_handler!`, and in the manifest, and every declared surface agrees
 * while both bridges go on calling the dead name. Clean compile, runtime
 * failure. This is that missing half.
 *
 * Every declared command is reachable by calling a bridge method — seven on the
 * updater, three on backup — so this is a full set equality with no residual: a
 * declared command no bridge invokes fails it, and a bridge invoking a command
 * the manifest does not declare fails it too.
 */
describe("route parity: the desktop-only bridges against the manifest", () => {
  it("invokes exactly the commands declared desktopOnly", async () => {
    const invoked: string[] = [];
    const recordingInvoke = (command: string): Promise<unknown> => {
      invoked.push(command);
      return Promise.resolve(undefined);
    };

    const updater = createTauriUpdater({ invoke: recordingInvoke });
    const backup = createTauriBackup({ invoke: recordingInvoke });

    // Driven through the real signatures, so a renamed or dropped bridge method
    // fails to compile here rather than silently dropping a command from the
    // union. Arguments are inert — none of them reaches a command name — and
    // rejections are fine, since the invoke is recorded before any response is
    // unwrapped.
    await Promise.allSettled([
      updater.check(),
      updater.install(),
      updater.relaunch(),
      updater.getSetting("k"),
      updater.setSetting("k", "v"),
      updater.backup("label"),
      updater.clearBackups(),
      backup.exportBackup("pw"),
      backup.stageRestore("pw"),
      backup.hasPendingRestore(),
    ]);

    // A union: two bridge methods may legitimately share one command, and that
    // is not drift. Copies are sorted so neither the manifest nor the call order
    // above is load-bearing.
    expect([...new Set(invoked)].sort()).toEqual(
      [...routes.desktopOnly].sort(),
    );
  });
});
