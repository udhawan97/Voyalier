import { useState } from "react";
import type { PackInfo } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { Button } from "../components/Button";

/**
 * The catalog of downloadable city packs. Lazy — nothing is read until the user
 * asks — and read-only for now: it shows what each pack covers and under what
 * per-layer licenses (Overture places + a separate Wikivoyage notes layer).
 * Downloading a pack for a trip is a later, explicitly-consented step.
 */
export function CityPacks() {
  const gateway = useGateway();
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setPacks(await gateway.listPacks());
    } finally {
      setLoading(false);
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
            offline. Each pack pairs Overture places with a separate Wikivoyage
            notes layer, each under its own license.
          </p>
          <Button variant="secondary" busy={loading} onClick={load}>
            Browse city packs
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
                aria-label={`${pack.name} data layers`}
              >
                {pack.layers.map((layer) => (
                  <li key={layer.layer} className="voy-packs__layer">
                    {layer.source} · {layer.license}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <p className="voy-packs__scope">
        Browsing only — downloading a pack for this trip is the next step, and
        will always be an explicit, per-trip choice.
      </p>
    </section>
  );
}
