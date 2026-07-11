import { useId, useState } from "react";
import type {
  AppError,
  PersonaWeights,
  Recommendation,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { Button } from "../components/Button";

type Dimension = keyof PersonaWeights;

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "food", label: "Food" },
  { key: "culture", label: "Culture" },
  { key: "nature", label: "Nature" },
  { key: "nightlife", label: "Nightlife" },
  { key: "shopping", label: "Shopping" },
];

const PRESETS: { name: string; weights: PersonaWeights }[] = [
  {
    name: "Balanced",
    weights: {
      food: 0.5,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    },
  },
  {
    name: "Foodie",
    weights: {
      food: 1,
      culture: 0.4,
      nature: 0.3,
      nightlife: 0.6,
      shopping: 0.3,
    },
  },
  {
    name: "Explorer",
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDimension(key: Dimension, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const result = await gateway.getRecommendations(tripId, weights);
      setRecs(result);
      announce(
        result.length === 0
          ? "No recommendations yet."
          : `${result.length} recommendations.`,
      );
    } catch (caught) {
      setRecs(null);
      setError(describeError(caught as AppError).title);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="voy-recs" aria-labelledby="recs-title">
      <h2 id="recs-title" className="voy-recs__title">
        Recommendations
      </h2>
      <p className="voy-recs__intro">
        Ranked picks from a downloaded city pack, weighted by your interests.
        The scoring is a transparent rule — not a model — and each pick keeps
        its source and license.
      </p>

      <div
        className="voy-recs__presets"
        role="group"
        aria-label="Persona presets"
      >
        {PRESETS.map((preset) => (
          <Button
            key={preset.name}
            variant="ghost"
            onClick={() => setWeights(preset.weights)}
          >
            {preset.name}
          </Button>
        ))}
      </div>

      <div className="voy-recs__sliders">
        {DIMENSIONS.map(({ key, label }) => {
          const id = `${baseId}-${key}`;
          return (
            <div key={key} className="voy-recs__slider">
              <label htmlFor={id}>
                {label}
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
        Get recommendations
      </Button>

      {error ? (
        <p className="voy-recs__error" role="alert">
          {error}
        </p>
      ) : null}

      {recs !== null ? (
        recs.length === 0 ? (
          <p className="voy-recs__none">
            No recommendations yet — download a city pack for this trip (under
            “Offline city data”), or widen your interests.
          </p>
        ) : (
          <ul className="voy-recs__list" aria-label="Recommended places">
            {recs.map((rec) => (
              <li
                key={`${rec.name}:${rec.lat},${rec.lon}`}
                className="voy-recs__row"
              >
                <div className="voy-recs__row-head">
                  <span className="voy-recs__name">{rec.name}</span>
                  <span className="voy-recs__dim">{rec.dimension}</span>
                  {rec.wildcard ? (
                    <span className="voy-recs__wild">wildcard</span>
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

      <p className="voy-recs__scope">
        Suggestions from open place data — never authoritative for prices,
        hours, or safety. Nothing leaves your device.
      </p>
    </section>
  );
}
