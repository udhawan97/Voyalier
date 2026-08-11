import { useEffect, useRef, useState } from "react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, formatInstantDate } from "../app/format";
import { searchSourceKey, t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { Button } from "../components/Button";
import { ArrowLeftIcon, SearchIcon } from "../components/icons";

/**
 * What to call a result.
 *
 * A confirmed fact carries its own identifying data — "SFO → KIX", a property
 * name — and that is what names it. The localized noun is only the floor for a
 * fact with nothing identifying, and for notes, which have no name of their
 * own. The snippet underneath stays as the raw matched text on purpose: it is
 * the evidence for *why* this result matched, the same instinct as the review
 * dialog's quoted spans.
 */
function resultLabel(hit: WorkspaceSearchHit): string {
  if (hit.source === "note") return t("workspaceSearch.label.note");
  if (hit.label) return hit.label;
  if (hit.source === "confirmed_fact") {
    return t("workspaceSearch.label.confirmedFact");
  }
  return hit.label;
}

/**
 * The query lives above this component, in the App's view state.
 *
 * Leaving for Settings unmounts this whole subtree, so a query held only in
 * local state died on the way out and the traveler came back to an empty box
 * having typed nothing wrong. `initialQuery` seeds it on the way in and
 * `onQueryChange` reports it on the way out; the debounce, the request-id
 * guard and the hits stay local, because none of those are worth restoring —
 * re-running the search on return is cheap and always correct.
 */
export function WorkspaceSearch({
  onBack,
  onOpenResult,
  initialQuery = "",
  onQueryChange,
}: {
  onBack: () => void;
  onOpenResult: (hit: WorkspaceSearchHit) => void;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
}) {
  const gateway = useGateway();
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<WorkspaceSearchHit[] | null>(null);
  const requestIdRef = useRef(0);
  const action = useAsyncAction(
    (...args: [value: string, requestId: number]) =>
      gateway.searchWorkspace(args[0]),
    (result, _value, requestId) => {
      if (requestId === requestIdRef.current) setHits(result);
    },
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Coming back from a detour: the box is refilled, so the results have to
  // follow it. Restoring the text and leaving the list empty would read as
  // "your query now matches nothing", which is a worse lie than losing it was.
  useEffect(() => {
    if (!initialQuery.trim()) return;
    requestIdRef.current += 1;
    void action.run(initialQuery.trim(), requestIdRef.current);
    // Mount only: this seeds from the view state, and every later keystroke is
    // handled by handleQueryChange's own debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runSearch(value: string) {
    requestIdRef.current += 1;
    void action.run(value, requestIdRef.current);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    onQueryChange?.(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!next.trim()) {
      requestIdRef.current += 1;
      setHits(null);
      return;
    }
    timerRef.current = setTimeout(() => runSearch(next.trim()), 250);
  }

  return (
    <div className="voy-workspace-search">
      <button type="button" className="voy-back" onClick={onBack}>
        <ArrowLeftIcon aria-hidden="true" />
        <span>{t("workspaceSearch.back")}</span>
      </button>
      {/* A hand-rolled h1, matching what the trip list, trip detail, Settings
          and the vault unlock each already do. This was the one top-level view
          without one, because `SectionTitle` renders an h2 — correct where it
          titles a section inside a page, wrong as this view's only heading, and
          not something to change on the shared primitive. */}
      <h1 id="workspace-search-title" className="voy-workspace-search__title">
        <SearchIcon aria-hidden="true" />
        <span>{t("workspaceSearch.title")}</span>
      </h1>
      <p>{t("workspaceSearch.intro")}</p>
      <form
        className="voy-workspace-search__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (timerRef.current) clearTimeout(timerRef.current);
          if (query.trim()) runSearch(query.trim());
        }}
      >
        <label>
          <span className="voy-sr-only">{t("workspaceSearch.label")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("workspaceSearch.placeholder")}
            onChange={(event) => handleQueryChange(event.target.value)}
          />
        </label>
        <Button type="submit" busy={action.busy} icon={<SearchIcon />}>
          {t("workspaceSearch.search")}
        </Button>
      </form>
      {/* Transport reachability belongs to the workspace banner and its global
          Retry. Search still owns validation, storage and domain failures. */}
      {action.error && action.error.code !== "transport/failure" ? (
        <p role="alert">{describeError(action.error).title}</p>
      ) : null}
      {hits ? (
        hits.length === 0 ? (
          <>
            <p>{t("workspaceSearch.none")}</p>
            {/* The intro above says what is searched, but it is three lines up
                and was written before the traveler had a failure to explain.
                Saying it again here, where the failure is, is the difference
                between a dead end and a next step. */}
            <p className="voy-workspace-search__recover">
              {t("workspaceSearch.none.recover")}
            </p>
          </>
        ) : (
          <ul className="voy-workspace-search__results">
            {hits.map((hit) => (
              <li key={`${hit.source}:${hit.recordId}`}>
                <button type="button" onClick={() => onOpenResult(hit)}>
                  <strong>{resultLabel(hit)}</strong>
                  <span>
                    <span>{hit.tripTitle}</span> ·{" "}
                    <span>{t(searchSourceKey(hit.source))}</span>
                    {hit.tripStatus === "archived" ? (
                      <>
                        {" · "}
                        <span>{t("workspaceSearch.archived")}</span>
                      </>
                    ) : null}
                  </span>
                  <span>
                    {t("workspaceSearch.updated", {
                      date: formatInstantDate(hit.tripUpdatedAt),
                    })}
                  </span>
                  <span>{hit.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
