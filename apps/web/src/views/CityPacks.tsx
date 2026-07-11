import { useState } from "react";
import type { AppError, DownloadedPack, PackInfo } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, pluralize } from "../app/format";
import { t } from "../app/i18n";
import { Button } from "../components/Button";

/**
 * The catalog of downloadable city packs, with per-trip download. Lazy —
 * nothing is read until the user asks. Downloading pulls a pack's place data
 * and travel notes *in* from GitHub and stores them on this device for the
 * trip; nothing about the trip is sent. Each pack keeps Overture places and a
 * separate Wikivoyage notes layer, each under its own license.
 */
export function CityPacks({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [downloaded, setDownloaded] = useState<Map<string, DownloadedPack>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function indexById(list: DownloadedPack[]) {
    return new Map(list.map((pack) => [pack.packId, pack]));
  }

  async function load() {
    setLoading(true);
    try {
      const [catalog, mine] = await Promise.all([
        gateway.listPacks(),
        gateway.listDownloadedPacks(tripId),
      ]);
      setPacks(catalog);
      setDownloaded(indexById(mine));
    } finally {
      setLoading(false);
    }
  }

  async function download(pack: PackInfo) {
    setError(null);
    setBusyId(pack.id);
    try {
      const result = await gateway.downloadPack(tripId, pack.id);
      setDownloaded((prev) => new Map(prev).set(pack.id, result));
      announce(t("packs.announce.downloaded", { name: pack.name }));
    } catch (caught) {
      setError(describeError(caught as AppError).title);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(pack: PackInfo) {
    setError(null);
    setBusyId(pack.id);
    try {
      await gateway.deleteDownloadedPack(tripId, pack.id);
      setDownloaded((prev) => {
        const next = new Map(prev);
        next.delete(pack.id);
        return next;
      });
      announce(t("packs.announce.removed", { name: pack.name }));
    } catch (caught) {
      setError(describeError(caught as AppError).title);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="voy-packs" aria-labelledby="packs-title">
      <h2 id="packs-title" className="voy-packs__title">
        {t("packs.title")}
      </h2>

      {packs === null ? (
        <>
          <p className="voy-packs__intro">{t("packs.intro")}</p>
          <Button variant="secondary" busy={loading} onClick={load}>
            {t("packs.browse")}
          </Button>
        </>
      ) : (
        <ul className="voy-packs__list">
          {packs.map((pack) => {
            const mine = downloaded.get(pack.id);
            return (
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
                {mine ? (
                  <div className="voy-packs__downloaded">
                    {/* counts keep English pluralize() pending Intl.PluralRules */}
                    <span className="voy-packs__count">
                      {mine.placeCount} {pluralize(mine.placeCount, "place")}
                      {", "}
                      {mine.articleCount} {pluralize(mine.articleCount, "note")}{" "}
                      · offline
                    </span>
                    <Button
                      variant="ghost"
                      busy={busyId === pack.id}
                      onClick={() => remove(pack)}
                    >
                      {t("packs.remove")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    busy={busyId === pack.id}
                    onClick={() => download(pack)}
                  >
                    {t("packs.download")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="voy-packs__error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="voy-packs__scope">{t("packs.scope")}</p>
    </section>
  );
}
