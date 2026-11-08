import type { AppError, AppGateway } from "@voyalier/contracts";

type NoteSnapshot = {
  draft: string | null;
  state: "idle" | "saving" | "saved";
  error: AppError | null;
};

interface NotesWriter {
  getSnapshot(): NoteSnapshot;
  subscribe(listener: () => void): () => void;
  edit(body: string): void;
  flush(loadedBody?: string): Promise<void>;
  append(id: string, text: string): Promise<void>;
}
const writers = new WeakMap<AppGateway, Map<string, NotesWriter>>();

/** One writer covers the Notes field and every Chat reply for this trip. */
export function notesWriter(gateway: AppGateway, tripId: string): NotesWriter {
  let trips = writers.get(gateway);
  if (!trips) {
    trips = new Map();
    writers.set(gateway, trips);
  }
  return trips.get(tripId) ?? createNotesWriter(gateway, tripId, trips);
}

function createNotesWriter(
  gateway: AppGateway,
  tripId: string,
  trips: Map<string, NotesWriter>,
) {
  let snapshot: NoteSnapshot = { draft: null, state: "idle", error: null };
  let committed: string | undefined;
  let initialized = false;
  let writing: Promise<void> | undefined;
  let initialRead: Promise<string> | undefined;
  let appending = 0;
  const appended = new Set<string>();
  const listeners = new Set<() => void>();

  function releaseIfIdle() {
    if (
      !listeners.size &&
      !appending &&
      !writing &&
      (snapshot.draft === null || snapshot.draft === committed) &&
      trips.get(tripId) === writer
    )
      trips.delete(tripId);
  }

  function publish(next: NoteSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function persist() {
    while (snapshot.draft !== null && snapshot.draft !== committed) {
      const next = snapshot.draft;
      publish({ ...snapshot, state: "saving", error: null });
      try {
        committed = (await gateway.setTripNotes(tripId, next)).body;
      } catch (caught) {
        // A lost acknowledgement leaves even the previously loaded body uncertain.
        committed = undefined;
        if (snapshot.draft === next) {
          publish({ ...snapshot, state: "idle", error: caught as AppError });
          return;
        }
      }
    }
    publish({ ...snapshot, state: "saved", error: null });
  }

  const writer = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      trips.set(tripId, writer);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        releaseIfIdle();
      };
    },
    edit(body: string) {
      trips.set(tripId, writer);
      publish({ draft: body, state: "idle", error: null });
    },
    async flush(loadedBody = "") {
      if (snapshot.draft === null) return;
      if (!initialized) {
        committed = loadedBody;
        initialized = true;
      }
      do {
        if (!writing) {
          writing = persist().finally(() => {
            writing = undefined;
            releaseIfIdle();
          });
        }
        await writing;
        // Another submitter may have changed the draft after the write
        // settled but before its promise released the queue.
      } while (!snapshot.error && snapshot.draft !== committed);
    },
    async append(id: string, text: string) {
      trips.set(tripId, writer);
      appending += 1;
      try {
        // The Notes section can still be deferred. Read storage only when no
        // local draft exists, then prefer any edit made while that read waited.
        let stored = "";
        if (snapshot.draft === null) {
          initialRead ??= gateway
            .getTripNotes(tripId)
            .then((notes) => notes.body)
            .finally(() => {
              initialRead = undefined;
            });
          stored = await initialRead;
        }
        if (!appended.has(id)) {
          const body = snapshot.draft ?? stored;
          writer.edit(body ? `${body}\n\n${text}` : text);
          // A failed acknowledgement is retried with the same desired body.
          appended.add(id);
        }
        await writer.flush(stored);
        if (snapshot.error) throw snapshot.error;
        appended.delete(id);
      } finally {
        appending -= 1;
        releaseIfIdle();
      }
    },
  };
  return writer;
}
