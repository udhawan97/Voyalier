import { useState } from "react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
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
  const action = useAsyncAction(
    () => gateway.searchWorkspace(query),
    (result) => setHits(result),
  );

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
          if (query.trim()) void action.run();
        }}
      >
        <label>
          <span className="voy-sr-only">{t("workspaceSearch.label")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("workspaceSearch.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
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
                  <span>{hit.tripTitle}</span>
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
