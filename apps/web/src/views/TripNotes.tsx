import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import type { AppError, AppGateway } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
import { notesScope, useScopeKey } from "../app/revalidate";
import { useAsyncData } from "../app/useAsync";
import { PencilIcon } from "../components/icons";
import { SectionTitle, Skeleton } from "../components/primitives";

/** How long to wait after the last keystroke before saving. */
const SAVE_DEBOUNCE_MS = 800;

type NoteSnapshot = {
  draft: string | null;
  state: "idle" | "saving" | "saved";
  error: AppError | null;
};

/** Pending writers outlive a panel so returning to a trip cannot race teardown. */
const pendingWriters = new WeakMap<AppGateway, Map<string, NotesWriter>>();
type NotesWriter = ReturnType<typeof createNotesWriter>;

function createNotesWriter(gateway: AppGateway, tripId: string) {
  let snapshot: NoteSnapshot = { draft: null, state: "idle", error: null };
  let committed: string | undefined;
  let initialized = false;
  let inFlight = false;
  const listeners = new Set<() => void>();
  const publish = (next: NoteSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const writer = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit(next: string) {
      pendingWriters.get(gateway)!.set(tripId, writer);
      publish({ draft: next, state: "idle", error: null });
    },
    async flush(loadedBody = "") {
      if (inFlight || snapshot.draft === null) return;
      if (!initialized) {
        committed = loadedBody;
        initialized = true;
      }
      const next = snapshot.draft;
      if (next === committed) {
        pendingWriters.get(gateway)!.delete(tripId);
        return;
      }
      inFlight = true;
      publish({ ...snapshot, state: "saving", error: null });
      try {
        const stored = await gateway.setTripNotes(tripId, next);
        committed = stored.body;
        if (snapshot.draft === next) {
          publish({ ...snapshot, state: "saved", error: null });
          pendingWriters.get(gateway)!.delete(tripId);
        }
      } catch (caught) {
        // A failed response cannot establish what reached storage. Retry the
        // latest desire even if it equals the body loaded before this request.
        committed = undefined;
        if (snapshot.draft === next) {
          publish({ ...snapshot, state: "idle", error: caught as AppError });
        }
      } finally {
        inFlight = false;
        // Coalesce everything typed during this request into one ordered write.
        if (snapshot.draft !== next) void writer.flush();
      }
    },
  };
  return writer;
}

function notesWriter(gateway: AppGateway, tripId: string): NotesWriter {
  let writers = pendingWriters.get(gateway);
  if (!writers) {
    writers = new Map();
    pendingWriters.set(gateway, writers);
  }
  return writers.get(tripId) ?? createNotesWriter(gateway, tripId);
}

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
