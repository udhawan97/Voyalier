import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { plural, t } from "../app/i18n";
import { Button } from "../components/Button";
import { BedIcon, PlaneIcon } from "../components/icons";

const MAX_QUERY = 200;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

function hitIcon(hit: SearchHit) {
  if (hit.source === "confirmed_fact") {
    return hit.label.startsWith("Flight") ? <PlaneIcon /> : <BedIcon />;
  }
  return null;
}

/** Replace the query's last whitespace word with a chosen suggestion term. */
function withLastWord(query: string, term: string): string {
  const words = query.trimEnd().split(/\s+/);
  if (words.length === 0 || words[0] === "") return term;
  words[words.length - 1] = term;
  return words.join(" ");
}

/**
 * Relaxed, as-you-type search over this trip's imported documents and confirmed
 * facts. Any query word matches (partial words too), matching terms are offered
 * as autofill suggestions, and each result can be copied to reuse its value.
 * Purely local; nothing leaves the device.
 */
export function TripSearch({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const inputId = useId();
  const [query, setQuery] = useState("");
  // null = nothing searched yet; [] = searched, nothing found.
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function runSearch(raw: string) {
    const trimmed = raw.trim();
    // Invalidate any in-flight request on every call, including the too-short
    // path — otherwise an older query that lands after the box is cleared would
    // repopulate results and announce a stale count.
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (trimmed.length < MIN_QUERY) {
      setResults(null);
      setSuggestions([]);
      return;
    }
    const [hits, terms] = await Promise.all([
      gateway.searchTrip(tripId, trimmed).catch(() => [] as SearchHit[]),
      gateway.suggestSearchTerms(tripId, trimmed).catch(() => [] as string[]),
    ]);
    if (requestId !== requestRef.current) return; // a newer query superseded this
    setResults(hits);
    // Don't suggest a term the user has already fully typed.
    setSuggestions(
      terms.filter((term) => term.toLowerCase() !== trimmed.toLowerCase()),
    );
    announce(
      hits.length === 0
        ? t("search.announce.none", { query: trimmed })
        : plural("search.matches", hits.length, { query: trimmed }),
    );
  }

  function handleChange(next: string) {
    setQuery(next);
    setCopiedKey(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSearch(next), DEBOUNCE_MS);
  }

  function applySuggestion(term: string) {
    const next = withLastWord(query, term);
    setQuery(next);
    setSuggestions([]);
    if (timerRef.current) clearTimeout(timerRef.current);
    void runSearch(next);
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
      <h2 id="trip-search-title" className="voy-search__title">
        {t("search.title")}
      </h2>
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
          maxLength={MAX_QUERY}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          onChange={(event) => handleChange(event.target.value)}
        />
      </div>

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
                      {hit.label}
                      <span className="voy-search__hit-kind">
                        {" · "}
                        {hit.source === "document"
                          ? t("search.hit.document")
                          : t("search.hit.confirmed")}
                      </span>
                    </span>
                    <span className="voy-search__hit-snippet">
                      {hit.snippet}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => copyHit(hit)}
                    aria-label={t("search.copy.aria", { value: hit.snippet })}
                  >
                    {copiedKey === key ? t("search.copied") : t("search.copy")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
