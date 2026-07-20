import { useEffect, useRef, useState } from "react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, formatDate } from "../app/format";
import { t, type MessageKey } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { Button } from "../components/Button";
import { ArrowLeftIcon, SearchIcon } from "../components/icons";
import { SectionTitle } from "../components/primitives";

export function WorkspaceSearch({
  onBack,
  onOpenTrip,
}: {
  onBack: () => void;
  onOpenTrip: (tripId: string) => void;
}) {
  const gateway = useGateway();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WorkspaceSearchHit[] | null>(null);
  const requestIdRef = useRef(0);
  const action = useAsyncAction(
    (value: string, _requestId: number) => gateway.searchWorkspace(value),
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

  function runSearch(value: string) {
    requestIdRef.current += 1;
    void action.run(value, requestIdRef.current);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
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
      <SectionTitle id="workspace-search-title" icon={<SearchIcon />}>
        {t("workspaceSearch.title")}
      </SectionTitle>
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
      {action.error ? (
        <p role="alert">{describeError(action.error).title}</p>
      ) : null}
      {hits ? (
        hits.length === 0 ? (
          <p>{t("workspaceSearch.none")}</p>
        ) : (
          <ul className="voy-workspace-search__results">
            {hits.map((hit) => (
              <li key={`${hit.source}:${hit.recordId}`}>
                <button type="button" onClick={() => onOpenTrip(hit.tripId)}>
                  <strong>{hit.label}</strong>
                  <span>
                    <span>{hit.tripTitle}</span> ·{" "}
                    <span>
                      {t(
                        `workspaceSearch.source.${hit.source}` as MessageKey,
                      )}
                    </span>
                    {hit.tripStatus === "archived" ? (
                      <>
                        {" · "}
                        <span>{t("workspaceSearch.archived")}</span>
                      </>
                    ) : null}
                  </span>
                  <span>
                    {t("workspaceSearch.updated", {
                      date: formatDate(hit.tripUpdatedAt.slice(0, 10)),
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
