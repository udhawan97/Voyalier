import { useId, useState } from "react";
import type { AppError, SearchHit } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, pluralize } from "../app/format";
import { t } from "../app/i18n";
import { Button } from "../components/Button";
import { BedIcon, PlaneIcon } from "../components/icons";

const MAX_QUERY = 200;

function hitIcon(hit: SearchHit) {
  if (hit.source === "confirmed_fact") {
    return hit.label.startsWith("Flight") ? <PlaneIcon /> : <BedIcon />;
  }
  return null;
}

/**
 * Deterministic local search over this trip's imported documents and confirmed
 * facts. Results carry provenance (what matched, where) and never leave the
 * device.
 */
export function TripSearch({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // null = no search yet; [] = searched, nothing found.
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setFieldError(t("search.error.empty"));
      return;
    }
    setSearching(true);
    try {
      const hits = await gateway.searchTrip(tripId, trimmed);
      setResults(hits);
      setLastQuery(trimmed);
      announce(
        // The match-count announce keeps English pluralize() pending the
        // Intl.PluralRules pass; the no-match case is catalogued.
        hits.length === 0
          ? t("search.announce.none", { query: trimmed })
          : `${hits.length} ${pluralize(hits.length, "match", "matches")} for ${trimmed}.`,
      );
    } catch (caught) {
      const appError = caught as AppError;
      if (appError.code === "validation/invalid_input") {
        setFieldError(appError.message);
      } else {
        setFieldError(describeError(appError).title);
      }
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="voy-search" aria-labelledby="trip-search-title">
      <h2 id="trip-search-title" className="voy-search__title">
        {t("search.title")}
      </h2>
      <form className="voy-search__form" onSubmit={handleSubmit} noValidate>
        <label className="voy-sr-only" htmlFor={inputId}>
          {t("search.label")}
        </label>
        <input
          id={inputId}
          className="voy-search__input"
          type="search"
          value={query}
          maxLength={MAX_QUERY}
          placeholder={t("search.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${inputId}-error` : undefined}
        />
        <Button variant="secondary" type="submit" busy={searching}>
          {t("search.submit")}
        </Button>
      </form>
      {fieldError ? (
        <p id={`${inputId}-error`} className="voy-search__error" role="alert">
          {fieldError}
        </p>
      ) : null}

      {results !== null ? (
        results.length === 0 ? (
          <p className="voy-search__none">
            {t("search.none", { query: lastQuery })}
          </p>
        ) : (
          <ul
            className="voy-search__results"
            aria-label={t("search.results.aria")}
          >
            {results.map((hit) => (
              <li
                key={`${hit.source}:${hit.recordId}`}
                className="voy-search__hit"
              >
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
                  <span className="voy-search__hit-snippet">{hit.snippet}</span>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
