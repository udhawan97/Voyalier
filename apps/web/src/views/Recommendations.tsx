import { useId, useState } from "react";
import type {
  AppError,
  InterestProfile,
  PersonaWeights,
  Recommendation,
  SavedPlace,
} from "@voyalier/contracts";
import { savedPlaceIdentity } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { useAsyncAction } from "../app/useAsync";
import { describeError } from "../app/format";
import { plural, t, type MessageKey } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { CompassIcon } from "../components/icons";
import { Button } from "../components/Button";
import { toAppError } from "../gateway/errors";

type Dimension = keyof PersonaWeights;

const DIMENSIONS: { key: Dimension; label: MessageKey }[] = [
  { key: "food", label: "recs.dim.food" },
  { key: "culture", label: "recs.dim.culture" },
  { key: "nature", label: "recs.dim.nature" },
  { key: "nightlife", label: "recs.dim.nightlife" },
  { key: "shopping", label: "recs.dim.shopping" },
];

const DIMENSION_MESSAGES: Record<string, MessageKey> = {
  food: "recs.dim.food",
  culture: "recs.dim.culture",
  nature: "recs.dim.nature",
  nightlife: "recs.dim.nightlife",
  shopping: "recs.dim.shopping",
};

function dimensionLabel(dimension: string): string {
  const key = DIMENSION_MESSAGES[dimension];
  return key ? t(key) : dimension;
}

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
export function Recommendations({
  tripId,
  profile,
  savedPlaces,
  onChanged,
}: {
  tripId: string;
  profile?: InterestProfile;
  savedPlaces?: SavedPlace[];
  onChanged?: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const baseId = useId();
  const [weights, setWeights] = useState<PersonaWeights>(
    profile ?? PRESETS[0].weights,
  );
  const [savedWeights, setSavedWeights] = useState<PersonaWeights>(
    profile ?? PRESETS[0].weights,
  );
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [recommendationWeights, setRecommendationWeights] =
    useState<PersonaWeights | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<AppError | undefined>();
  function setDimension(key: Dimension, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  const loadAction = useAsyncAction(
    (requestedWeights: PersonaWeights) =>
      gateway.getRecommendations(tripId, requestedWeights),
    (result, requestedWeights) => {
      setRecs(result);
      setRecommendationWeights(requestedWeights);
      announce(
        result.length === 0
          ? t("recs.announce.none")
          : plural("recs.announce.count", result.length),
      );
    },
  );
  const load = () => loadAction.run(weights);
  const loading = loadAction.busy;
  const error = loadAction.error;
  const interestsDirty = DIMENSIONS.some(
    ({ key }) => weights[key] !== savedWeights[key],
  );
  const saveInterests = useAsyncAction(
    () => gateway.setInterestProfile({ tripId, ...weights }),
    (saved) => {
      setSavedWeights(saved);
      announce(t("recs.interests.saved"));
      onChanged?.();
    },
  );

  async function save(rec: Recommendation) {
    const id = `${rec.packId}:${rec.name}:${rec.lat},${rec.lon}`;
    setSaveError(undefined);
    setSavingId(id);
    try {
      await gateway.savePlace({
        tripId,
        recommendation: rec,
        weights: recommendationWeights ?? weights,
      });
      announce(t("recs.saved", { name: rec.name }));
      onChanged?.();
    } catch (cause) {
      setSaveError(toAppError(cause));
    } finally {
      setSavingId(null);
    }
  }

  const isSaved = (rec: Recommendation) =>
    savedPlaces?.some(
      (place) =>
        place.packId === rec.packId &&
        savedPlaceIdentity(place.name) === savedPlaceIdentity(rec.name) &&
        place.lat === rec.lat &&
        place.lon === rec.lon,
    ) ?? false;

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

      {saveInterests.error ? (
        <p className="voy-recs__error" role="alert">
          {describeError(saveInterests.error).title}
        </p>
      ) : null}

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

      <div className="voy-recs__interest-actions">
        <Button
          variant="ghost"
          busy={saveInterests.busy}
          disabled={!interestsDirty}
          onClick={() => void saveInterests.run()}
        >
          {t("recs.interests.save")}
        </Button>
        <span role="status">
          {interestsDirty
            ? t("recs.interests.unsaved")
            : t("recs.interests.saved")}
        </span>
      </div>

      <Button variant="secondary" busy={loading} onClick={load}>
        {t("recs.get")}
      </Button>

      {error ? (
        <p className="voy-recs__error" role="alert">
          {describeError(error).title}
        </p>
      ) : null}

      {saveError ? (
        <p className="voy-recs__error" role="alert">
          {describeError(saveError).title}
        </p>
      ) : null}

      {recs !== null ? (
        recs.length === 0 ? (
          <p className="voy-recs__none">{t("recs.none")}</p>
        ) : (
          <ul className="voy-recs__list" aria-label={t("recs.list.aria")}>
            {recs.map((rec) => {
              const id = `${rec.packId}:${rec.name}:${rec.lat},${rec.lon}`;
              const saved = isSaved(rec);
              return (
                <li key={id} className="voy-recs__row">
                  <div className="voy-recs__row-head">
                    <span className="voy-recs__name">{rec.name}</span>
                    <span className="voy-recs__dim">
                      {dimensionLabel(rec.dimension)}
                    </span>
                    {rec.wildcard ? (
                      <span className="voy-recs__wild">
                        {t("recs.wildcard")}
                      </span>
                    ) : null}
                  </div>
                  <p className="voy-recs__reasons">
                    {t("recs.reason.interest", {
                      dimension: dimensionLabel(
                        rec.dimension,
                      ).toLocaleLowerCase(),
                    })}
                    {rec.wildcard ? ` · ${t("recs.reason.wildcard")}` : ""}
                  </p>
                  <p className="voy-recs__prov">
                    {rec.category} · {rec.source} ({rec.license})
                  </p>
                  <Button
                    variant="ghost"
                    busy={savingId === id}
                    disabled={saved}
                    onClick={() => save(rec)}
                  >
                    {saved ? t("recs.savedAlready") : t("recs.save")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      <p className="voy-recs__scope">{t("recs.scope")}</p>
    </section>
  );
}
