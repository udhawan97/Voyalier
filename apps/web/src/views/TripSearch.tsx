import { useEffect, useId, useRef, useState } from "react";
import { MAX_QUERY_LEN, countChars, type SearchHit } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { plural, t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { SectionTitle } from "../components/primitives";
import { Button } from "../components/Button";
import {
  BedIcon,
  CompassIcon,
  PlaneIcon,
  SearchIcon,
} from "../components/icons";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
const LIMIT_GUIDANCE_START = MAX_QUERY_LEN - 20;

function hitIcon(hit: SearchHit) {
  if (hit.source === "resource") return <CompassIcon />;
  if (hit.source === "confirmed_fact") {
    return hit.factType === "flight_segment" ? <PlaneIcon /> : <BedIcon />;
  }
  return null;
}

function hitLabel(hit: SearchHit): string {
  if (hit.source === "document" || hit.source === "resource") return hit.label;
  if (hit.factType === "flight_segment") {
    return hit.subject
      ? t("search.label.flight", { subject: hit.subject })
      : t("search.label.flightGeneric");
  }
  return hit.subject ?? t("search.label.stayGeneric");
}

function hitKindLabel(hit: SearchHit): string {
  if (hit.source === "document") return t("search.hit.document");
  if (hit.source === "resource") return t("search.hit.resource");
  return t("search.hit.confirmed");
}

/** Replace the query's last whitespace word with a chosen suggestion term. */
function withLastWord(query: string, term: string): string {
  const words = query.trimEnd().split(/\s+/);
  if (words.length === 0 || words[0] === "") return term;
  words[words.length - 1] = term;
  return words.join(" ");
}

/**
 * Relaxed, as-you-type search over this trip's imported documents, confirmed
 * facts, and saved research. Any query word matches (partial words too),
 * matching terms are offered as autofill suggestions, and each result can
 * return to its local source or be copied for reuse. Purely local; nothing
 * leaves the device.
 */
export function TripSearch({
  tripId,
  onOpenResult,
}: {
  tripId: string;
  onOpenResult: (hit: SearchHit) => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const inputId = useId();
  const limitId = useId();
  const [query, setQuery] = useState("");
  // null = nothing searched yet; [] = searched, nothing found.
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const composingRef = useRef(false);
  const queryLength = countChars(query.trim());
  const queryTooLong = queryLength > MAX_QUERY_LEN;
  const showLimit = queryLength >= LIMIT_GUIDANCE_START;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * The search failing is not the same as the trip having nothing to show, so it
   * runs through the shared action: a rejection lands in `action.error` and is
   * stated, instead of being caught into an empty list that renders as "No
   * matches" — which told the traveler their own documents lacked a word they
   * had read in them.
   *
   * The typeahead stays best-effort. Losing the autofill chips is not worth
   * interrupting a search that worked.
   */
  const action = useAsyncAction(
    async (...args: [query: string, requestId: number]) => {
      const [query] = args;
      const [hits, terms] = await Promise.all([
        gateway.searchTrip(tripId, query),
        gateway.suggestSearchTerms(tripId, query).catch(() => [] as string[]),
      ]);
      return { hits, terms };
    },
    ({ hits, terms }, query, requestId) => {
      // The hook drops a superseded *run*, but clearing the box starts no run at
      // all — so an older query that lands afterwards is still "current" to the
      // hook and would repopulate results. This id is what discards it.
      if (requestId !== requestRef.current) return;
      setResults(hits);
      // Don't suggest a term the user has already fully typed.
      setSuggestions(
        terms.filter((term) => term.toLowerCase() !== query.toLowerCase()),
      );
      announce(
        hits.length === 0
          ? t("search.announce.none", { query })
          : plural("search.matches", hits.length, { query }),
      );
    },
  );

  function runSearch(raw: string, requestId: number) {
    const trimmed = raw.trim();
    const length = countChars(trimmed);
    if (length < MIN_QUERY || length > MAX_QUERY_LEN) {
      setResults(null);
      setSuggestions([]);
      return;
    }
    void action.run(trimmed, requestId);
  }

  function handleChange(next: string) {
    // Intent changes synchronously; waiting for the debounce to invalidate the
    // old request briefly put actionable old results under the new query and
    // let an old failure flash before its replacement even started.
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    action.invalidate();
    setQuery(next);
    setResults(null);
    setSuggestions([]);
    setCopiedKey(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (composingRef.current || countChars(next.trim()) > MAX_QUERY_LEN) return;
    timerRef.current = setTimeout(
      () => void runSearch(next, requestId),
      DEBOUNCE_MS,
    );
  }

  function applySuggestion(term: string) {
    const next = withLastWord(query, term);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    action.invalidate();
    setQuery(next);
    setResults(null);
    setSuggestions([]);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    void runSearch(next, requestId);
  }

  async function copyHit(hit: SearchHit) {
    // Optional chaining would let `await undefined` resolve and show a false
    // "Copied" when no clipboard exists — require the API before claiming success.
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(hit.snippet);
      setCopiedKey(`${hit.source}:${hit.recordId}`);
      announce(t("search.announce.copied"));
    } catch {
      // Clipboard unavailable (e.g. denied) — leave the value on screen to copy
      // by hand rather than failing loudly.
    }
  }

  return (
    <section className="voy-search" aria-labelledby="trip-search-title">
      <SectionTitle id="trip-search-title" icon={<SearchIcon />}>
        {t("search.title")}
      </SectionTitle>
      <p className="voy-search__hint">{t("search.hint")}</p>

      <div className="voy-search__form">
        <label className="voy-sr-only" htmlFor={inputId}>
          {t("search.label")}
        </label>
        <input
          id={inputId}
          className="voy-search__input"
          type="search"
          role="searchbox"
          value={query}
          aria-describedby={showLimit ? limitId : undefined}
          aria-errormessage={queryTooLong ? limitId : undefined}
          aria-invalid={queryTooLong || undefined}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          onCompositionStart={() => {
            composingRef.current = true;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            handleChange(event.currentTarget.value);
          }}
          onChange={(event) => handleChange(event.target.value)}
        />
      </div>

      {showLimit ? (
        <p
          id={limitId}
          className={`voy-search__limit${
            queryTooLong ? " voy-search__limit--error" : ""
          }`}
          role={queryTooLong ? "alert" : "status"}
        >
          {queryTooLong
            ? t("search.error.tooLong", { max: MAX_QUERY_LEN })
            : t("search.limit", {
                count: queryLength,
                max: MAX_QUERY_LEN,
              })}
        </p>
      ) : null}

      {action.error ? (
        <p className="voy-search__error" role="alert">
          {describeError(action.error).title}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="voy-search__suggestions">
          <span className="voy-search__suggestions-label" aria-hidden="true">
            {t("search.suggestions.label")}
          </span>
          <ul
            className="voy-search__chips"
            aria-label={t("search.suggestions.aria")}
          >
            {suggestions.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  className="voy-search__chip"
                  onClick={() => applySuggestion(term)}
                >
                  {term}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {results !== null ? (
        results.length === 0 ? (
          <p className="voy-search__none">
            {t("search.none", { query: query.trim() })}
          </p>
        ) : (
          <ul
            className="voy-search__results"
            aria-label={t("search.results.aria")}
          >
            {results.map((hit) => {
              const key = `${hit.source}:${hit.recordId}`;
              return (
                <li key={key} className="voy-search__hit">
                  <span className="voy-search__hit-icon" aria-hidden="true">
                    {hitIcon(hit)}
                  </span>
                  <span className="voy-search__hit-body">
                    <span className="voy-search__hit-label">
                      {hitLabel(hit)}
                      <span className="voy-search__hit-kind">
                        {" · "}
                        {hitKindLabel(hit)}
                      </span>
                    </span>
                    <span className="voy-search__hit-snippet">
                      {hit.snippet}
                    </span>
                  </span>
                  <span className="voy-search__hit-actions">
                    <Button
                      variant="secondary"
                      onClick={() => onOpenResult(hit)}
                      aria-label={t("search.showSource.aria", {
                        label: hitLabel(hit),
                      })}
                    >
                      {t("search.showSource")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => copyHit(hit)}
                      aria-label={t("search.copy.aria", { value: hit.snippet })}
                    >
                      {copiedKey === key
                        ? t("search.copied")
                        : t("search.copy")}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
