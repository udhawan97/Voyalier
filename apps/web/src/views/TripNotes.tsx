import { useEffect, useId, useRef, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
import { useAsyncData } from "../app/useAsync";
import { PencilIcon } from "../components/icons";
import { SectionTitle, Skeleton } from "../components/primitives";

/** How long to wait after the last keystroke before saving. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * Free-text notes for a trip.
 *
 * The README sells Voyalier as a home for "half-made plans", and until now a
 * trip had nowhere to put a thought that wasn't a flight or a hotel.
 *
 * Notes are sealed at rest and are excluded from the brief and from AI requests
 * by construction: both are built from the trip plus its confirmed facts, and
 * notes are neither. The UI says so, because a promise the user cannot see is
 * not worth much.
 *
 * Plain text only — no markdown rendering. Anything the traveler types is shown
 * back exactly as typed.
 */
export function TripNotes({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const fieldId = useId();
  const { status, data } = useAsyncData(
    () => gateway.getTripNotes(tripId),
    `notes:${tripId}`,
  );
  // The traveler's unsaved edit. `null` means "untouched", in which case the
  // loaded notes are shown.
  //
  // This is derived rather than copied into state by an effect on purpose. A
  // hydrating effect would capture "not typed yet" in its closure, so anyone who
  // started typing before it ran would have their first words overwritten by the
  // load landing a moment later. Deriving cannot race: once `draft` is set, it
  // wins, whenever the load arrives.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What is known to be stored, so an unchanged blur never saves. Null until a
  // save succeeds, at which point it overrides whatever was loaded.
  const savedBody = useRef<string | null>(null);

  const body = draft ?? data?.body ?? "";

  useEffect(() => {
    // Cancel a pending save if the panel unmounts mid-debounce.
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function save(next: string) {
    // Read the ref here, not during render: what is already stored is whatever a
    // save last wrote, falling back to whatever loaded.
    const committed = savedBody.current ?? data?.body ?? "";
    if (next === committed) return;
    setState("saving");
    setError(null);
    try {
      const stored = await gateway.setTripNotes(tripId, next);
      savedBody.current = stored.body;
      setState("saved");
    } catch (caught) {
      const appError = caught as AppError;
      setError(
        appError.code === "validation/invalid_input"
          ? t("notes.tooLong")
          : describeError(appError).title || t("notes.error"),
      );
      setState("idle");
    }
  }

  function change(next: string) {
    setDraft(next);
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS);
  }

  return (
    <section className="voy-notes" aria-labelledby="notes-title">
      <SectionTitle id="notes-title" icon={<PencilIcon />}>
        {t("notes.title")}
      </SectionTitle>
      <p className="voy-notes__intro">{t("notes.intro")}</p>

      {status === "loading" && data === undefined ? (
        <Skeleton height="7rem" />
      ) : (
        <>
          <label className="voy-sr-only" htmlFor={fieldId}>
            {t("notes.label")}
          </label>
          <textarea
            id={fieldId}
            className="voy-notes__field"
            value={body}
            placeholder={t("notes.placeholder")}
            rows={6}
            onChange={(event) => change(event.target.value)}
            // Leaving the field commits immediately rather than waiting out the
            // debounce — closing the app a moment later must not lose the edit.
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current);
              void save(body);
            }}
          />
          <div className="voy-notes__foot">
            <p className="voy-notes__excluded">{t("notes.excluded")}</p>
            <p className="voy-notes__state" role="status" aria-live="polite">
              {state === "saving"
                ? t("notes.saving")
                : state === "saved"
                  ? t("notes.saved")
                  : ""}
            </p>
          </div>
          {error ? (
            <p className="voy-notes__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
