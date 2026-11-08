import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { notesWriter } from "../app/notesWriter";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
import { notesScope, useScopeKey } from "../app/revalidate";
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
  const {
    status,
    data,
    error: loadError,
  } = useAsyncData(
    () => gateway.getTripNotes(tripId),
    useScopeKey(notesScope(tripId)),
  );
  const writer = useMemo(() => notesWriter(gateway, tripId), [gateway, tripId]);
  const { draft, state, error } = useSyncExternalStore(
    writer.subscribe,
    writer.getSnapshot,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedBody = useRef("");
  useEffect(() => {
    loadedBody.current = data?.body ?? "";
  }, [data]);
  const body = draft ?? data?.body ?? "";

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // Back can unmount without blur; the same writer continues across remount.
      void writer.flush(loadedBody.current);
    };
  }, [writer]);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void writer.flush(data?.body ?? "");
  }

  function change(next: string) {
    writer.edit(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  return (
    <section
      className="voy-notes"
      aria-labelledby="notes-title"
      tabIndex={-1}
      data-continuity-state={status}
      data-search-source={data ? "note" : undefined}
      data-search-record={data ? tripId : undefined}
    >
      <SectionTitle id="notes-title" icon={<PencilIcon />} tabIndex={-1}>
        {t("notes.title")}
      </SectionTitle>
      <p className="voy-notes__intro">{t("notes.intro")}</p>

      {status === "loading" && data === undefined ? (
        <Skeleton height="7rem" />
      ) : loadError && data === undefined ? (
        <p className="voy-notes__error" role="alert">
          {describeError(loadError).title}
        </p>
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
            onBlur={flush}
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
              {error.code === "validation/invalid_input"
                ? t("notes.tooLong")
                : describeError(error).title || t("notes.error")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
