import { useState } from "react";
import type { AppError, DownloadedPack, PackInfo } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, pluralize } from "../app/format";
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
      announce(`${pack.name} pack downloaded.`);
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
      announce(`${pack.name} pack removed.`);
    } catch (caught) {
      setError(describeError(caught as AppError).title);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="voy-packs" aria-labelledby="packs-title">
      <h2 id="packs-title" className="voy-packs__title">
        Offline city data
      </h2>

      {packs === null ? (
        <>
          <p className="voy-packs__intro">
            Download local place data and travel notes for a city to use
            offline. Downloading pulls a pack in from GitHub and stores it on
            this device for this trip — nothing about your trip is sent. Each
            pack pairs Overture places with a separate Wikivoyage notes layer,
            each under its own license.
          </p>
          <Button variant="secondary" busy={loading} onClick={load}>
            Browse city packs
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
                  aria-label={`${pack.name} data layers`}
                >
                  {pack.layers.map((layer) => (
                    <li key={layer.layer} className="voy-packs__layer">
                      {layer.source} · {layer.license}
                    </li>
                  ))}
                </ul>
                {mine ? (
                  <div className="voy-packs__downloaded">
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
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    busy={busyId === pack.id}
                    onClick={() => download(pack)}
                  >
                    Download for this trip
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

      <p className="voy-packs__scope">
        Packs are stored on this device for this trip. Downloading pulls data in
        from GitHub; nothing about your trip is sent.
      </p>
    </section>
  );
}
