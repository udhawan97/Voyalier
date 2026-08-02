import { createMockGateway } from "@voyalier/contracts";
import ts from "typescript";

// Vite's `?raw` rather than node:fs: apps/web has no @types/node, and reading
// the contract is not worth adding one.
import contractSource from "../../../packages/contracts/src/index.ts?raw";

/**
 * ADR-0009: hold the mock to the contract's *fields*, not only to the core's
 * rules.
 *
 * ADR-0004's goldens compare behaviour on cases, so a field the mock never
 * populates has no case and nothing to disagree with. That is how
 * `VisaPrep.suggestedNationalityIso2` shipped absent: declared in the contract,
 * filled by the real gateway, read by the passport picker, and never written
 * here — so every component test exercised only the empty branch and the
 * prefill was quietly dead in mock mode.
 *
 * This walks the contract's optional properties, drives a workspace through the
 * mock, and fails on any that are never populated. The property list is read
 * from the contract source rather than kept by hand, because a hand-kept list
 * fails the way the hand-kept Tauri command list did in 0.6.0 — by never
 * including the new one.
 */

interface Prop {
  name: string;
  optional: boolean;
  /** The named type behind it, if it is one worth descending into. */
  type: string | undefined;
}

/** `Promise<VisaPrep>` → `VisaPrep`; `SearchHit[]` → `SearchHit`. */
function namedType(node: ts.TypeNode | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isArrayTypeNode(node)) return namedType(node.elementType);
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name === "Promise" || name === "Array") {
      return namedType(node.typeArguments?.[0]);
    }
    return name;
  }
  return undefined;
}

const source = ts.createSourceFile(
  "index.ts",
  contractSource,
  ts.ScriptTarget.Latest,
  true,
);

/** interface name → its own properties. */
const own = new Map<string, Prop[]>();
/** interface name → the interfaces it extends. */
const parents = new Map<string, string[]>();
/** gateway method name → the type it resolves to. */
const returns = new Map<string, string>();

for (const statement of source.statements) {
  if (!ts.isInterfaceDeclaration(statement)) continue;
  const name = statement.name.text;

  if (name === "AppGateway") {
    for (const member of statement.members) {
      if (!ts.isMethodSignature(member)) continue;
      const type = namedType(member.type);
      if (type) returns.set(member.name.getText(), type);
    }
    continue;
  }

  own.set(
    name,
    statement.members.filter(ts.isPropertySignature).map((member) => ({
      name: member.name.getText(),
      optional: member.questionToken !== undefined,
      type: namedType(member.type),
    })),
  );
  parents.set(
    name,
    (statement.heritageClauses ?? []).flatMap((clause) =>
      clause.types.map((type) => type.expression.getText()),
    ),
  );
}

/**
 * Own properties plus inherited ones. `InterestProfile extends PersonaWeights`
 * and friends are common here, and an inherited optional field goes untested
 * exactly as easily as a declared one.
 */
const shapes = new Map<string, Prop[]>();
for (const name of own.keys()) {
  const collected: Prop[] = [];
  const pending = [name];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    collected.push(...(own.get(current) ?? []));
    pending.push(...(parents.get(current) ?? []));
  }
  shapes.set(name, collected);
}

/**
 * Fields the mock deliberately never populates. Each needs a reason: the list
 * is the point of the guard, not a way around it.
 */
const EXPECTED_ABSENT = new Set<string>([
  // The mock workspace is never a packaged desktop build, so no restore is
  // ever staged.
  "HealthResponse.pendingRestore",

  // Reached here only through `getTripBrief`, whose whole purpose is to strip
  // them — the fixture facts do carry both. `ConfirmedFact.payload` is a union,
  // and this walk follows named interfaces rather than union members, so the
  // unredacted path does not reach these. Widening the walk to unions would
  // buy this one case and a lot of ambiguity about which member a value is.
  "FlightSegmentPayload.confirmationCode",
  "FlightSegmentPayload.passengerName",
  "LodgingStayPayload.confirmationCode",
  "LodgingStayPayload.guestName",

  // Japan publishes 110 for police and 119 for fire and ambulance, and no
  // single general number. An absent `general` is the honest answer for the
  // fixture destination, not a gap.
  "EmergencyNumbers.general",

  // Only set while a trip is under way, and no fixture trip spans today —
  // Kyoto is ahead and Oslo is behind. Driving these would mean a fixture trip
  // whose dates move with the clock, which is worse than the gap.
  "TripPhase.day",
  "TripPhase.totalDays",
]);

/** A scripted workspace: every branch a response can take at least once. */
async function driveWorkspace(): Promise<Array<[string, unknown]>> {
  const gateway = createMockGateway();
  const seen: Array<[string, unknown]> = [];
  const record = async (method: string, run: Promise<unknown>) => {
    seen.push([method, await run]);
  };

  await record("health", gateway.health());
  await record("listTrips", gateway.listTrips());
  await record("listDocuments", gateway.listDocuments("trip_kyoto"));
  await record("listCandidates", gateway.listCandidates("trip_kyoto"));
  await record("searchTrip", gateway.searchTrip("trip_kyoto", "Kyoto"));
  await record("searchWorkspace", gateway.searchWorkspace("Kyoto"));
  await record("listPacks", gateway.listPacks());
  await record("suggestPacks", gateway.suggestPacks("trip_kyoto"));
  await record("getVaultStatus", gateway.getVaultStatus());
  await record("getTripBrief", gateway.getTripBrief("trip_kyoto"));

  // Every snapshot a trip can carry, so `getTrip` below returns a fully
  // furnished TripDetail rather than the bare one a fresh trip starts with.
  await record("fetchWeather", gateway.fetchWeather("trip_kyoto"));
  await record(
    "fetchDestinationFacts",
    gateway.fetchDestinationFacts("trip_kyoto"),
  );
  await record(
    "fetchPublicHolidays",
    gateway.fetchPublicHolidays("trip_kyoto"),
  );
  await record("fetchPlaceSummary", gateway.fetchPlaceSummary("trip_kyoto"));
  // The sweep runs after the snapshots above exist, so its lines carry the
  // `previouslyRetrievedAt` a never-fetched trip would leave absent.
  await record("recheckTrip", gateway.recheckTrip("trip_kyoto"));
  await record(
    "fetchAdvisories",
    gateway.fetchAdvisories({ tripId: "trip_kyoto", countrySlug: "japan" }),
  );

  // Traveler-owned planning: an interest profile carries an updatedAt, and two
  // overlapping trip items are what makes a planned-item conflict.
  await record(
    "setInterestProfile",
    gateway.setInterestProfile({
      tripId: "trip_kyoto",
      food: 0.8,
      culture: 0.6,
      nature: 0.4,
      nightlife: 0.2,
      shopping: 0.5,
    }),
  );
  await gateway.createTripItem({
    tripId: "trip_kyoto",
    kind: "activity",
    title: "Fushimi Inari",
    startAt: "2026-11-05T09:00",
    endAt: "2026-11-05T12:00",
  });
  await gateway.createTripItem({
    tripId: "trip_kyoto",
    kind: "activity",
    title: "Nishiki Market",
    startAt: "2026-11-05T10:00",
    endAt: "2026-11-05T13:00",
    location: "Nakagyo Ward",
    notes: "Overlaps the shrine walk on purpose — this is the conflict case.",
  });

  // A configured provider carries its model.
  await record(
    "setProviderModel",
    gateway.setProviderModel({ provider: "openai", model: "gpt-4o" }),
  );
  await record("listProviders", gateway.listProviders());

  // Visa: both branches. An unset trip carries the prefill suggestion, a set
  // one carries the journey — the bug that motivated this lived in the first.
  await gateway.setVisaNationality({
    tripId: "trip_kyoto",
    nationalityIso2: "IN",
  });
  await record("getVisaPrep", gateway.getVisaPrep("trip_kyoto"));
  await record("getVisaPrep", gateway.getVisaPrep("trip_lisbon"));

  // The playbook needs an uncurated route with a passport set (spec
  // 2026-08-02), and the statistics zone needs both fetchable authorities:
  // Canada covers per-country audience rows, the UK covers the source's own
  // published-at stamp.
  const paris = await gateway.createTrip({
    origin: "Delhi",
    destination: "Paris",
    startDate: "2027-04-01",
    endDate: "2027-04-10",
  });
  await gateway.setVisaNationality({
    tripId: paris.id,
    nationalityIso2: "IN",
  });
  await record("getVisaPrep", gateway.getVisaPrep(paris.id));
  const london = await gateway.createTrip({
    origin: "Delhi",
    destination: "London",
    startDate: "2027-05-01",
    endDate: "2027-05-10",
  });
  await gateway.setVisaNationality({
    tripId: london.id,
    nationalityIso2: "IN",
  });
  await record("refreshVisaStats", gateway.refreshVisaStats(london.id));
  await gateway.setVisaNationality({
    tripId: "trip_lisbon",
    nationalityIso2: "IN",
  });
  await record("refreshVisaStats", gateway.refreshVisaStats("trip_lisbon"));
  await record("getVisaPrep", gateway.getVisaPrep("trip_lisbon"));

  // A saved place, so a trip item can point at one. It has to come from a real
  // recommendation, which is the contract's way of saying a saved place always
  // keeps the provenance it was saved with.
  const weights = {
    food: 0.8,
    culture: 0.6,
    nature: 0.4,
    nightlife: 0.2,
    shopping: 0.5,
  };
  // Recommendations only exist once a pack is downloaded, which is the
  // product's rule: a suggestion has to come from data the traveler consented
  // to fetch.
  const [suggestion] = await gateway.suggestPacks("trip_kyoto");
  await record(
    "downloadPack",
    gateway.downloadPack("trip_kyoto", suggestion.pack.id),
  );
  const recommendations = await gateway.getRecommendations(
    "trip_kyoto",
    weights,
  );
  const saved = await gateway.savePlace({
    tripId: "trip_kyoto",
    recommendation: recommendations[0],
    weights,
    notes: "Saved by the field-coverage walk.",
  });
  await gateway.createTripItem({
    tripId: "trip_kyoto",
    kind: "activity",
    title: "Saved place visit",
    savedPlaceId: saved.id,
  });

  // Last, so they see everything above. Oslo is in the past, which is the only
  // way `TripPhase.daysAgo` is ever set.
  await record("getTrip", gateway.getTrip("trip_kyoto"));
  await record("getToday", gateway.getToday("trip_kyoto"));
  await record("getToday", gateway.getToday("trip_oslo"));

  return seen;
}

describe("mock field coverage", () => {
  it("parses the contract it is meant to be checking", () => {
    // A source walk that silently matches nothing passes every assertion below,
    // so prove it found the surface first — the same reason the Rust route
    // parity test bans wiring forms its parser cannot read.
    expect(shapes.size).toBeGreaterThan(40);
    expect(returns.size).toBeGreaterThan(60);
    expect(shapes.get("VisaPrep")?.map((p) => p.name)).toContain(
      "suggestedNationalityIso2",
    );
  });

  it("populates every optional contract field at least once", async () => {
    const populated = new Set<string>();
    const reached = new Set<string>();

    const visit = (typeName: string | undefined, value: unknown) => {
      if (!typeName || value == null) return;
      const props = shapes.get(typeName);
      if (!props) return;
      if (Array.isArray(value)) {
        for (const entry of value) visit(typeName, entry);
        return;
      }
      if (typeof value !== "object") return;
      reached.add(typeName);
      for (const prop of props) {
        const held = (value as Record<string, unknown>)[prop.name];
        if (held === undefined || held === null) continue;
        populated.add(`${typeName}.${prop.name}`);
        visit(prop.type, held);
      }
    };

    for (const [method, value] of await driveWorkspace()) {
      visit(returns.get(method), value);
    }

    const missing = [...reached]
      .flatMap((typeName) =>
        (shapes.get(typeName) ?? [])
          .filter((prop) => prop.optional)
          .map((prop) => `${typeName}.${prop.name}`),
      )
      .filter((key) => !populated.has(key) && !EXPECTED_ABSENT.has(key));

    expect(
      missing,
      `the mock never populates these declared fields, so nothing tests them. ` +
        `Fill them in mock.ts, or add them to EXPECTED_ABSENT with a reason.`,
    ).toEqual([]);
  });
});
