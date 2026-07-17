import { useEffect, useState } from "react";
import type {
  DownloadedPack,
  PackInfo,
  PackMatchKind,
  PackSuggestion,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { useAsyncAction } from "../app/useAsync";
import { describeError } from "../app/format";
import { plural, t, type MessageKey } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { PackageIcon } from "../components/icons";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";

const MATCH_REASON: Record<PackMatchKind, MessageKey> = {
  exact: "packs.suggested.matchExact",
  alias: "packs.suggested.matchAlias",
  partial: "packs.suggested.matchPartial",
};

/**
 * The catalog of downloadable city packs, with per-trip download. The
 * "Recommended for this trip" block is a local, zero-network match of the trip's
 * destination against the compiled-in catalog — it fetches on open but sends
 * nothing. Browsing the full catalog stays lazy. Downloading pulls a pack's
 * place data and travel notes *in* from GitHub and stores them on this device;
 * nothing about the trip is sent. Each pack keeps Overture places and a separate
 * Wikivoyage notes layer, each under its own license.
 */
export function CityPacks({
  tripId,
  destination,
}: {
  tripId: string;
  destination: string;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [suggestions, setSuggestions] = useState<PackSuggestion[] | null>(null);
  const [downloaded, setDownloaded] = useState<Map<string, DownloadedPack>>(
    new Map(),
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  function indexById(list: DownloadedPack[]) {
    return new Map(list.map((pack) => [pack.packId, pack]));
  }

  // Suggestions + the already-downloaded set are local reads, so they load when
  // the panel mounts. The full catalog stays behind "Browse".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [suggested, mine] = await Promise.all([
          gateway.suggestPacks(tripId),
          gateway.listDownloadedPacks(tripId),
        ]);
        if (cancelled) return;
        setSuggestions(suggested);
        setDownloaded(indexById(mine));
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, tripId]);

  // Browsing the catalog had a try/finally with no catch, so a failed listPacks
  // became an unhandled rejection and the user saw the button stop spinning.
  const loadAction = useAsyncAction(
    () =>
      Promise.all([gateway.listPacks(), gateway.listDownloadedPacks(tripId)]),
    ([catalog, mine]) => {
      setPacks(catalog);
      setDownloaded(indexById(mine));
    },
  );
  const load = () => loadAction.run();
  const loading = loadAction.busy;

  const downloadAction = useAsyncAction(
    async (pack: PackInfo) => ({
      pack,
      result: await gateway.downloadPack(tripId, pack.id),
    }),
    ({ pack, result }) => {
      setDownloaded((prev) => new Map(prev).set(pack.id, result));
      announce(t("packs.announce.downloaded", { name: pack.name }));
    },
  );

  const removeAction = useAsyncAction(
    async (pack: PackInfo) => {
      await gateway.deleteDownloadedPack(tripId, pack.id);
      return pack;
    },
    (pack) => {
      setDownloaded((prev) => {
        const next = new Map(prev);
        next.delete(pack.id);
        return next;
      });
      announce(t("packs.announce.removed", { name: pack.name }));
    },
  );

  // Both actions are per-pack, so the row needs to know *which* pack is busy.
  // run() never rejects, so the id always gets cleared.
  async function download(pack: PackInfo) {
    setBusyId(pack.id);
    await downloadAction.run(pack);
    setBusyId(null);
  }

  async function remove(pack: PackInfo) {
    setBusyId(pack.id);
    await removeAction.run(pack);
    setBusyId(null);
  }

  const error = downloadAction.error ?? removeAction.error ?? loadAction.error;

  function packControl(pack: PackInfo, downloadLabel: string) {
    const mine = downloaded.get(pack.id);
    if (mine) {
      return (
        <div className="voy-packs__downloaded">
          <span className="voy-packs__count">
            {plural("packs.places", mine.placeCount)}
            {", "}
            {plural("packs.notes", mine.articleCount)}
            {" · "}
            {t("packs.offline")}
            {mine.offlineMapReady ? ` · ${t("packs.offlineMap")}` : ""}
          </span>
          <ConfirmButton
            label={t("packs.remove")}
            busy={busyId === pack.id}
            onConfirm={() => remove(pack)}
          />
        </div>
      );
    }
    return (
      <Button
        variant="secondary"
        busy={busyId === pack.id}
        onClick={() => download(pack)}
      >
        {downloadLabel}
      </Button>
    );
  }

  return (
    <section className="voy-packs" aria-labelledby="packs-title">
      <SectionTitle id="packs-title" icon={<PackageIcon />}>
        {t("packs.title")}
      </SectionTitle>

      {suggestions && suggestions.length > 0 ? (
        <div className="voy-packs__suggested">
          <h3 className="voy-packs__suggested-title">
            {t("packs.suggested.title")}
          </h3>
          {suggestions.length > 1 ? (
            <p className="voy-packs__suggested-note">
              {t("packs.suggested.ambiguous")}
            </p>
          ) : null}
          <ul className="voy-packs__list">
            {suggestions.map((suggestion) => (
              <li key={suggestion.pack.id} className="voy-packs__row">
                <div className="voy-packs__row-head">
                  <span className="voy-packs__name">
                    {suggestion.pack.name}
                  </span>
                  <span className="voy-packs__region">
                    {suggestion.pack.region}
                  </span>
                </div>
                <p className="voy-packs__reason">
                  {t(MATCH_REASON[suggestion.matchKind])}
                </p>
                {suggestion.pack.offlineMapAvailable ? (
                  <p className="voy-packs__reason">
                    {t("packs.includesOfflineMap")}
                  </p>
                ) : null}
                {packControl(
                  suggestion.pack,
                  t("packs.suggested.download", {
                    name: suggestion.pack.name,
                  }),
                )}
              </li>
            ))}
          </ul>
          <p className="voy-packs__suggested-consent">
            {t("packs.suggested.consent")}
          </p>
        </div>
      ) : suggestions ? (
        <p className="voy-packs__suggested-none">
          {t("packs.suggested.none", { destination })}
        </p>
      ) : null}

      {packs === null ? (
        <>
          <p className="voy-packs__intro">{t("packs.intro")}</p>
          <Button variant="secondary" busy={loading} onClick={load}>
            {t("packs.browse")}
          </Button>
        </>
      ) : (
        <ul className="voy-packs__list">
          {packs.map((pack) => (
            <li key={pack.id} className="voy-packs__row">
              <div className="voy-packs__row-head">
                <span className="voy-packs__name">{pack.name}</span>
                <span className="voy-packs__region">{pack.region}</span>
              </div>
              <ul
                className="voy-packs__layers"
                aria-label={t("packs.layers.aria", { name: pack.name })}
              >
                {pack.layers.map((layer) => (
                  <li key={layer.layer} className="voy-packs__layer">
                    {layer.source} · {layer.license}
                  </li>
                ))}
              </ul>
              {pack.offlineMapAvailable ? (
                <p className="voy-packs__reason">
                  {t("packs.includesOfflineMap")}
                </p>
              ) : null}
              {packControl(pack, t("packs.download"))}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="voy-packs__error" role="alert">
          {describeError(error).title}
        </p>
      ) : null}

      <p className="voy-packs__scope">{t("packs.scope")}</p>
    </section>
  );
}
