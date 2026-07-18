import limits from "@voyalier/contracts/parity/limits.json";
import normalizePlaceGolden from "@voyalier/contracts/parity/normalize-place.json";
import assessTripGolden from "@voyalier/contracts/parity/assess-trip.json";
import packingGolden from "@voyalier/contracts/parity/packing.json";
import tripFactsGolden from "@voyalier/contracts/parity/trip-facts.json";
import type {
  ConfirmedFact,
  PublicHoliday,
  Trip,
  WeatherSnapshot,
} from "@voyalier/contracts";
import {
  MAX_AI_PROMPT_LEN,
  MAX_DOCUMENT_CHARS,
  MAX_LOCATION_LEN,
  MAX_NOTES_CHARS,
  MAX_QUERY_LEN,
  countChars,
  mockAssessReadiness,
  mockCountryFacts,
  mockDetectItineraryConflicts,
  mockHolidaysWithin,
  mockNormalizePlace,
  mockPackingList,
  mockTimeDifference,
  mockTippingGuidance,
} from "@voyalier/contracts";

/**
 * The contract and the Rust core enforce the same limits, in the same units.
 *
 * `packages/contracts/parity/limits.json` is the one declaration. This holds the
 * TypeScript side to it; `voyalier-core`'s `parity_limits_match_the_contract`
 * holds Rust to it. Neither side can drift without a red test.
 *
 * The mock used to hardcode each limit as a magic number *and* measure it with
 * `.length`, which counts UTF-16 code units where the core counts characters —
 * so it rejected input the real service accepts.
 */
describe("parity: validation limits", () => {
  it("matches the shared declaration", () => {
    expect({
      maxLocationLen: MAX_LOCATION_LEN,
      maxDocumentChars: MAX_DOCUMENT_CHARS,
      maxNotesChars: MAX_NOTES_CHARS,
      maxQueryLen: MAX_QUERY_LEN,
      maxAiPromptLen: MAX_AI_PROMPT_LEN,
    }).toEqual({
      maxLocationLen: limits.maxLocationLen,
      maxDocumentChars: limits.maxDocumentChars,
      maxNotesChars: limits.maxNotesChars,
      maxQueryLen: limits.maxQueryLen,
      maxAiPromptLen: limits.maxAiPromptLen,
    });
  });

  it("counts characters the way the core does, not UTF-16 code units", () => {
    // U+1F600 is one character and two UTF-16 code units. Counting the wrong
    // one is what made the mock reject a 3001-emoji prompt the core accepts.
    const emoji = "\u{1F600}".repeat(3001);
    expect(emoji.length).toBe(6002);
    expect(countChars(emoji)).toBe(3001);
    expect(countChars(emoji)).toBeLessThanOrEqual(MAX_AI_PROMPT_LEN);
  });

  it("counts astral and combining text like Rust's chars().count()", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("abc")).toBe(3);
    // Precomposed é is one char; ø and ß are one each.
    expect(countChars("Tromsø")).toBe(6);
    expect(countChars("Weißenburg")).toBe(10);
  });
});

/**
 * Place folding is implemented twice — the Rust core and the mock gateway — and
 * a destination is user-typed free text, so a disagreement means a pack matches
 * in one and not the other.
 *
 * `parity/normalize-place.json` is the one answer key; `voyalier-core`'s
 * `parity_normalize_place_matches_the_contract` checks the same cases. Both had
 * bugs, in opposite directions: the core sent accented capitals to a word
 * separator, and the mock dropped ø and ß because NFKD does not decompose them.
 */
describe("parity: normalizePlace", () => {
  const cases = normalizePlaceGolden.cases.filter(
    (entry): entry is { input: string; expected: string } =>
      typeof (entry as { input?: unknown }).input === "string",
  );

  it("covers every golden case", () => {
    // Exact, not a floor: a ">= 20" guard on 23 cases lets three quietly
    // disappear. Bump this when you add a case.
    expect(cases).toHaveLength(23);
  });

  it.each(cases)("folds $input to $expected", ({ input, expected }) => {
    expect(mockNormalizePlace(input)).toBe(expected);
  });
});

/**
 * The trip assessment — itinerary conflicts and the readiness rollup they drove
 * — is implemented twice: the Rust core, and the mock gateway every component
 * test runs against. Nothing compared them, so 28 test files asserted against a
 * mirror that could quietly say something else.
 *
 * `parity/assess-trip.json` is the one answer key; `voyalier-core`'s
 * `parity_assess_trip_matches_the_contract` checks the same cases. This pins
 * rule *output*, not just constants — the limits and folding goldens would not
 * have caught a mirror that computed a different verdict.
 */
describe("parity: assessTrip", () => {
  const cases = assessTripGolden.cases;

  it("covers every golden case", () => {
    expect(cases).toHaveLength(12);
  });

  it.each(cases)(
    "agrees with the core for: $name",
    ({ trip, facts, pendingCandidateCount, expected }) => {
      // The mock composes these the way its getTrip does.
      const conflicts = mockDetectItineraryConflicts(
        trip as Trip,
        facts as ConfirmedFact[],
      );
      const readiness = mockAssessReadiness(
        facts as ConfirmedFact[],
        pendingCandidateCount,
        conflicts,
      );
      expect({ conflicts, readiness }).toEqual(expected);
    },
  );
});

/**
 * Packing suggestions are implemented twice, and the mirror landed *after*
 * ADR-0004 asked for a golden per mirrored rule — six thresholds hand-copied
 * from the core's constants with nothing connecting them.
 *
 * The thresholds are no longer mirrored at all: `parity/packing.json` declares
 * them and `mockPackingList` reads that file, so this suite only has to prove
 * the mock uses them, and that the rules around them agree with the core.
 * `voyalier-core`'s `parity_packing_matches_the_contract` holds Rust to the
 * same file.
 */
describe("parity: packing list", () => {
  const cases = packingGolden.cases;

  it("covers every golden case", () => {
    expect(cases).toHaveLength(6);
  });

  it.each(cases)("agrees with the core for: $name", ({ trip, weather, facts, expected }) => {
    expect(
      mockPackingList(
        (weather ?? undefined) as WeatherSnapshot | undefined,
        facts as ConfirmedFact[],
        trip as Trip,
      ),
    ).toEqual(expected);
  });
});

/**
 * The destination-facts rules both languages derive on read.
 *
 * The facts family grew a source a day with hand-written mock fixtures beside
 * it and nothing comparing the two. Writing the golden found a real one: the
 * core's window narrowing sorts by date then name and collapses exact
 * duplicates, and the mock only filtered — so overlapping per-year fetches
 * could show a holiday twice, in whatever order the feed used.
 */
describe("parity: trip facts", () => {
  const timeDifference = tripFactsGolden.timeDifference.cases;
  const holidays = tripFactsGolden.holidaysWithin.cases;
  const tipping = tripFactsGolden.tipping.cases;
  const countryFacts = tripFactsGolden.countryFacts.cases;

  it("covers every golden case", () => {
    expect(timeDifference).toHaveLength(4);
    expect(holidays).toHaveLength(4);
    expect(tipping).toHaveLength(2);
    expect(countryFacts).toHaveLength(2);
  });

  it.each(timeDifference)(
    "time difference: $name",
    ({
      originPlace,
      originUtcOffsetMinutes,
      destinationUtcOffsetMinutes,
      expected,
    }) => {
      expect(
        mockTimeDifference(
          originPlace,
          originUtcOffsetMinutes,
          destinationUtcOffsetMinutes,
        ),
      ).toEqual(expected);
    },
  );

  it.each(holidays)(
    "holidays within the window: $name",
    ({ holidays: input, start, end, expected }) => {
      expect(mockHolidaysWithin(input as PublicHoliday[], start, end)).toEqual(
        expected,
      );
    },
  );

  it.each(tipping)("tipping guidance for $iso2", ({ iso2, expected }) => {
    expect(mockTippingGuidance(iso2) ?? null).toEqual(expected);
  });

  it.each(countryFacts)("country facts for $iso2", ({ iso2, expected }) => {
    expect(mockCountryFacts(iso2) ?? null).toEqual(expected);
  });
});
