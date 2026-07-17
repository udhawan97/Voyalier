import { useId, useState } from "react";
import type { PersonaWeights, Recommendation } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { useAsyncAction } from "../app/useAsync";
import { describeError } from "../app/format";
import { plural, t, type MessageKey } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { CompassIcon } from "../components/icons";
import { Button } from "../components/Button";

type Dimension = keyof PersonaWeights;

const DIMENSIONS: { key: Dimension; label: MessageKey }[] = [
  { key: "food", label: "recs.dim.food" },
  { key: "culture", label: "recs.dim.culture" },
  { key: "nature", label: "recs.dim.nature" },
  { key: "nightlife", label: "recs.dim.nightlife" },
  { key: "shopping", label: "recs.dim.shopping" },
];

const PRESETS: { nameKey: MessageKey; weights: PersonaWeights }[] = [
  {
    nameKey: "recs.preset.balanced",
    weights: {
      food: 0.5,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    },
  },
  {
    nameKey: "recs.preset.foodie",
    weights: {
      food: 1,
      culture: 0.4,
      nature: 0.3,
      nightlife: 0.6,
      shopping: 0.3,
    },
  },
  {
    nameKey: "recs.preset.explorer",
    weights: {
      food: 0.4,
      culture: 0.9,
      nature: 0.9,
      nightlife: 0.2,
      shopping: 0.3,
    },
  },
];

/**
 * Persona-weighted recommendations over this trip's downloaded pack places.
 * Lazy and deterministic — the scoring is a transparent rule, never a model —
 * and every pick shows its source, license, score, and "because" reasons. Empty
 * until a city pack with places has been downloaded for the trip.
 */
export function Recommendations({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const baseId = useId();
  const [weights, setWeights] = useState<PersonaWeights>(PRESETS[0].weights);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  function setDimension(key: Dimension, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  const loadAction = useAsyncAction(
    () => gateway.getRecommendations(tripId, weights),
    (result) => {
      setRecs(result);
      announce(
        result.length === 0
          ? t("recs.announce.none")
          : plural("recs.announce.count", result.length),
      );
    },
  );
  const load = () => loadAction.run();
  const loading = loadAction.busy;
  const error = loadAction.error;

  return (
    <section className="voy-recs" aria-labelledby="recs-title">
      <SectionTitle id="recs-title" icon={<CompassIcon />}>
        {t("recs.title")}
      </SectionTitle>
      <p className="voy-recs__intro">{t("recs.intro")}</p>

      <div
        className="voy-recs__presets"
        role="group"
        aria-label={t("recs.presets.aria")}
      >
        {PRESETS.map((preset) => (
          <Button
            key={preset.nameKey}
            variant="ghost"
            onClick={() => setWeights(preset.weights)}
          >
            {t(preset.nameKey)}
          </Button>
        ))}
      </div>

      <div className="voy-recs__sliders">
        {DIMENSIONS.map(({ key, label }) => {
          const id = `${baseId}-${key}`;
          return (
            <div key={key} className="voy-recs__slider">
              <label htmlFor={id}>
                {t(label)}
                <span className="voy-recs__weight">
                  {Math.round(weights[key] * 100)}
                </span>
              </label>
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                value={Math.round(weights[key] * 100)}
                onChange={(event) =>
                  setDimension(key, Number(event.target.value) / 100)
                }
              />
            </div>
          );
        })}
      </div>

      <Button variant="secondary" busy={loading} onClick={load}>
        {t("recs.get")}
      </Button>

      {error ? (
        <p className="voy-recs__error" role="alert">
          {describeError(error).title}
        </p>
      ) : null}

      {recs !== null ? (
        recs.length === 0 ? (
          <p className="voy-recs__none">{t("recs.none")}</p>
        ) : (
          <ul className="voy-recs__list" aria-label={t("recs.list.aria")}>
            {recs.map((rec) => (
              <li
                key={`${rec.name}:${rec.lat},${rec.lon}`}
                className="voy-recs__row"
              >
                <div className="voy-recs__row-head">
                  <span className="voy-recs__name">{rec.name}</span>
                  <span className="voy-recs__dim">{rec.dimension}</span>
                  {rec.wildcard ? (
                    <span className="voy-recs__wild">{t("recs.wildcard")}</span>
                  ) : null}
                </div>
                <p className="voy-recs__reasons">{rec.reasons.join(" · ")}</p>
                <p className="voy-recs__prov">
                  {rec.category} · {rec.source} ({rec.license})
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className="voy-recs__scope">{t("recs.scope")}</p>
    </section>
  );
}
