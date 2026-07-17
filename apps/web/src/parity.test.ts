import limits from "@voyalier/contracts/parity/limits.json";
import normalizePlaceGolden from "@voyalier/contracts/parity/normalize-place.json";
import {
  MAX_AI_PROMPT_LEN,
  MAX_DOCUMENT_CHARS,
  MAX_LOCATION_LEN,
  MAX_NOTES_CHARS,
  MAX_QUERY_LEN,
  countChars,
  mockNormalizePlace,
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
