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
