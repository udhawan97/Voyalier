import chatTopicsGolden from "@voyalier/contracts/parity/chat-topics.json";
import limits from "@voyalier/contracts/parity/limits.json";
import normalizePlaceGolden from "@voyalier/contracts/parity/normalize-place.json";
import savedPlaceIdentityGolden from "@voyalier/contracts/parity/saved-place-identity.json";
import assessTripGolden from "@voyalier/contracts/parity/assess-trip.json";
import packingGolden from "@voyalier/contracts/parity/packing.json";
import tripFactsGolden from "@voyalier/contracts/parity/trip-facts.json";
import visaGolden from "@voyalier/contracts/parity/visa.json";
import visaStatsSourcesGolden from "@voyalier/contracts/parity/visa-stats-sources.json";
import type {
  ConfirmedFact,
  PublicHoliday,
  Trip,
  WeatherSnapshot,
} from "@voyalier/contracts";
import {
  MAX_AI_PROMPT_LEN,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_RESOURCE_NOTE_CHARS,
  MAX_RESOURCE_TITLE_CHARS,
  MAX_RESOURCE_URL_CHARS,
  MAX_DOCUMENT_CHARS,
  MAX_LOCATION_LEN,
  MAX_NOTES_CHARS,
  MAX_QUERY_LEN,
  countChars,
  crossRate,
  mockAssessReadiness,
  mockCountryFacts,
  mockDetectItineraryConflicts,
  mockHighStakesTopics,
  mockHolidaysWithin,
  mockNormalizePlace,
  mockPackingList,
  mockTimeDifference,
  mockTippingGuidance,
  savedPlaceIdentity,
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
      maxChatMessageChars: MAX_CHAT_MESSAGE_CHARS,
      maxResourceTitleChars: MAX_RESOURCE_TITLE_CHARS,
      maxResourceNoteChars: MAX_RESOURCE_NOTE_CHARS,
      maxResourceUrlChars: MAX_RESOURCE_URL_CHARS,
    }).toEqual({
      maxLocationLen: limits.maxLocationLen,
      maxDocumentChars: limits.maxDocumentChars,
      maxNotesChars: limits.maxNotesChars,
      maxQueryLen: limits.maxQueryLen,
      maxAiPromptLen: limits.maxAiPromptLen,
      maxChatMessageChars: limits.maxChatMessageChars,
      maxResourceTitleChars: limits.maxResourceTitleChars,
      maxResourceNoteChars: limits.maxResourceNoteChars,
      maxResourceUrlChars: limits.maxResourceUrlChars,
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
 * The table behind the "Voyalier isn't the authority" pointer above a chat
 * reply. It used to be hand-copied into the mock, which knew 20 of the 48 words
 * and none of the 6 phrases — so a traveler asking about entry requirements,
 * customs, quarantine or terrorism got the local model's answer with nothing
 * above it, in exactly the mode contributors develop against.
 *
 * Now both languages read this file. The counts are pinned here and in
 * `crates/voyalier-core/src/tests.rs`.
 */
describe("parity: high-stakes chat topics", () => {
  const { topics } = chatTopicsGolden;

  it("covers every golden term", () => {
    expect(topics.flatMap((entry) => entry.words)).toHaveLength(
      chatTopicsGolden.wordCount,
    );
    expect(topics.flatMap((entry) => entry.phrases)).toHaveLength(
      chatTopicsGolden.phraseCount,
    );
    // Exact, not a floor. Bump both files when you add a term.
    expect(chatTopicsGolden.wordCount).toBe(48);
    expect(chatTopicsGolden.phraseCount).toBe(6);
  });

  it.each(
    topics.flatMap((entry) => entry.words.map((word) => [entry.topic, word])),
  )("raises %s for the word %s", (topic, word) => {
    expect(mockHighStakesTopics(`Tell me about ${word} please`)).toContain(
      topic,
    );
  });

  it.each(
    topics.flatMap((entry) =>
      entry.phrases.map((phrase) => [entry.topic, phrase]),
    ),
  )("raises %s for the phrase %s", (topic, phrase) => {
    expect(mockHighStakesTopics(`Tell me about ${phrase} please`)).toContain(
      topic,
    );
  });

  it("matches whole words, not substrings", () => {
    // "safe" fires; the supermarket does not.
    expect(mockHighStakesTopics("Where is the nearest Safeway?")).toEqual([]);
    expect(mockHighStakesTopics("Is it safe?")).toEqual(["safety"]);
  });

  it("orders every word match before any phrase match", () => {
    // The core scans all words first, then all phrases, and that order is the
    // order of the pointer cards. Folding it into one per-topic pass reverses
    // this case.
    expect(
      mockHighStakesTopics("Is it safe, and what are the entry requirements?"),
    ).toEqual(["safety", "entry"]);
  });

  it("says nothing about an ordinary question", () => {
    expect(mockHighStakesTopics("Where should I eat dinner?")).toEqual([]);
  });
});

describe("parity: savedPlaceIdentity", () => {
  const cases = savedPlaceIdentityGolden.cases;

  it("covers every golden case", () => {
    expect(cases).toHaveLength(14);
  });

  it.each(cases)("identifies $input as $expected", ({ input, expected }) => {
    expect(savedPlaceIdentity(input)).toBe(expected);
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

  it.each(cases)(
    "agrees with the core for: $name",
    ({ trip, weather, facts, expected }) => {
      expect(
        mockPackingList(
          (weather ?? undefined) as WeatherSnapshot | undefined,
          facts as ConfirmedFact[],
          trip as Trip,
        ),
      ).toEqual(expected);
    },
  );
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
/**
 * Curated visa journeys, pinned by structure rather than prose.
 *
 * The interface renders the curated copy verbatim from the core, so pinning it
 * here would turn every copy edit into golden churn without catching anything.
 * What must agree is the shape: which entry path a nationality quotes, which
 * steps exist in which order, and which document ids traveler progress is keyed
 * on — rename one of those and stored ticks silently detach from their document.
 * `voyalier-core`'s `parity_visa_journeys_match_the_contract` holds Rust to the
 * same file.
 */
// The destinations with curated authorities, and the one official domain each
// may cite. Mirrors official_domain_and_prefix in crates/voyalier-core. Module
// scope because both the journey and the statistics goldens are held to it.
const CURATED_DOMAINS = {
  CA: "https://www.canada.ca/",
  JP: "https://www.mofa.go.jp/",
  AU: "https://immi.homeaffairs.gov.au/",
  // Curated as authorities that resolve no route: each publishes a readable
  // list and gates it on something a passport code cannot answer, so they
  // name a source and never a path. They still belong here — an authority
  // without a route is curated, and must be held to its own domain.
  NZ: "https://www.immigration.govt.nz/",
  KR: "https://www.k-eta.go.kr/",
  US: "https://travel.state.gov/",
  // The UK appears in the statistics golden (UKVI publishes waiting times on
  // GOV.UK) though no journey golden case exercises it yet.
  GB: "https://www.gov.uk/",
} as const;

describe("parity: visa journeys", () => {
  const cases = visaGolden.cases;

  it("covers every golden case", () => {
    expect(cases).toHaveLength(15);
    expect(cases).toHaveLength(visaGolden.caseCount);
  });

  it.each(cases)(
    "quotes an attributed entry path for: $name",
    ({ destination, expected }) => {
      // No quote is a legitimate answer, and exactly one thing means it: nothing
      // is curated for this destination, so there is no authority to name. It
      // used to borrow the only authority there was, which put Canada in front
      // of travelers flying anywhere else (ADR-0006, amended 2026-07-29).
      if (expected.entryPath === null) {
        expect(CURATED_DOMAINS).not.toHaveProperty(destination);
        expect(expected.stepIds).toBeNull();
        return;
      }
      // Otherwise every path, including unknown, carries where it was read from
      // and when — and the authority named governs the destination quoted. Each
      // destination is held to its *own* domain, so a Japanese journey linking
      // canada.ca fails here rather than reading as attributed.
      expect(CURATED_DOMAINS).toHaveProperty(destination);
      expect(expected.entryPath.sourceName).not.toHaveLength(0);
      expect(
        expected.entryPath.sourceUrl.startsWith(
          CURATED_DOMAINS[destination as keyof typeof CURATED_DOMAINS],
        ),
      ).toBe(true);
      expect(expected.entryPath.curatedAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(expected.entryPath.language).toBe("en");
    },
  );

  it.each(cases)(
    "agrees with the core's journey shape for: $name",
    ({ expected }) => {
      const hasJourney = expected.stepIds !== null;
      // One direction only, and the direction is the safety-critical one: a
      // journey may exist *only* where the quoted path calls for one. Exempt
      // and unknown travelers get official links and nothing invented; an
      // uncurated destination has no quote to call for one at all.
      //
      // The converse does not hold, and Australia is why. Home Affairs routes
      // every unlisted passport to the subclass 600 visitor visa, so the path
      // resolves to visaRequired honestly — but that route is not curated
      // step-by-step yet, and quoting the department's own page with no
      // journey is the documented behaviour for an uncurated route. Requiring
      // a journey here would push toward either inventing steps or downgrading
      // a true path to unknown, and both are worse than saying less.
      if (hasJourney) {
        expect(
          expected.entryPath?.path === "visaRequired" ||
            expected.entryPath?.path === "electronicAuthorization",
        ).toBe(true);
      }
      if (!hasJourney) {
        expect(expected.routeLabel).toBeNull();
        expect(expected.documentIds).toBeNull();
        return;
      }
      // Ordinals are contiguous from 1, and document ids are unique because
      // traveler progress is keyed on them.
      expect(expected.ordinals).toEqual(
        expected.stepIds!.map((_, index) => index + 1),
      );
      expect(new Set(expected.documentIds!).size).toBe(
        expected.documentIds!.length,
      );
    },
  );

  it.each(cases)(
    "carries the playbook exactly where no journey resolves: $name",
    ({ expected }) => {
      // The universal playbook fills every gap a journey leaves (spec
      // 2026-08-02) — and only those gaps. Never both.
      const playbook = (
        expected as {
          playbook?: {
            stepIds: string[];
            ordinals: number[];
            documentIds: string[];
          } | null;
        }
      ).playbook;
      if (expected.stepIds !== null) {
        expect(playbook).toBeNull();
        return;
      }
      expect(playbook).not.toBeNull();
      expect(playbook!.stepIds).toHaveLength(6);
      expect(playbook!.ordinals).toEqual([1, 2, 3, 4, 5, 6]);
      // Ticks key on document ids: the shared playbook namespace must never
      // collide with a curated journey's destination-prefixed ids.
      expect(playbook!.documentIds.length).toBeGreaterThan(0);
      for (const id of playbook!.documentIds) {
        expect(id.startsWith("playbook-")).toBe(true);
      }
    },
  );
});

describe("parity: visa statistics sources", () => {
  // ADR-0014's source table, read by the mock for source rows and link-only
  // states — never mirrored.
  const sources = visaStatsSourcesGolden.sources;

  it("covers every named authority and no more", () => {
    expect(sources).toHaveLength(7);
    expect(sources).toHaveLength(visaStatsSourcesGolden.count);
  });

  it("marks exactly the two parsers this slice ships", () => {
    const fetchable = sources
      .filter((row) => row.fetchable)
      .map((row) => row.destinationIso2)
      .sort();
    expect(fetchable).toEqual(["CA", "GB"]);
  });

  it.each(sources)(
    "sends the traveler to $destinationIso2's own authority",
    (row) => {
      // The same per-destination domain rule the journeys are held to: a
      // statistics page must live on its own authority's domain.
      expect(row.authorityName).not.toHaveLength(0);
      expect(
        row.pageUrl.startsWith(
          CURATED_DOMAINS[row.destinationIso2 as keyof typeof CURATED_DOMAINS],
        ),
      ).toBe(true);
    },
  );
});

describe("parity: trip facts", () => {
  const timeDifference = tripFactsGolden.timeDifference.cases;
  const holidays = tripFactsGolden.holidaysWithin.cases;
  const tipping = tripFactsGolden.tipping.cases;
  const countryFacts = tripFactsGolden.countryFacts.cases;
  const crossRates = tripFactsGolden.crossRate.cases;

  it("covers every golden case", () => {
    expect(timeDifference).toHaveLength(4);
    expect(holidays).toHaveLength(4);
    expect(tipping).toHaveLength(2);
    expect(countryFacts).toHaveLength(2);
    expect(crossRates).toHaveLength(7);
  });

  it.each(crossRates)("cross rate: $name", ({ from, to, expected }) => {
    // The destination-facts panel had its own copy of this and the Rust core's
    // only caller was a test, so neither held the other to anything.
    expect(crossRate(tripFactsGolden.crossRate.rates, from, to)).toBe(expected);
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
