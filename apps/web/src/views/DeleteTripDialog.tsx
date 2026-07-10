import { useRef, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { TextField } from "../components/fields";

export function DeleteTripDialog({
  trip,
  onClose,
  onDeleted,
}: {
  trip: { id: string; title: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const gateway = useGateway();
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = confirmText.trim().toLowerCase() === "delete";

  async function handleDelete() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      await gateway.deleteTrip(trip.id);
      onDeleted();
    } catch (caught) {
      setError(caught as AppError);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      title="Delete this trip?"
      onClose={onClose}
      initialFocusRef={inputRef}
      description={`This permanently deletes “${trip.title}” and everything in it. This can't be undone.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            busy={submitting}
            disabled={!ready}
          >
            Delete trip
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
      <TextField
        id="delete-confirm"
        label="Type delete to confirm"
        inputRef={inputRef}
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        autoComplete="off"
        placeholder="delete"
        hint="Prefer to keep it? Archiving hides the trip without removing anything."
      />
    </Dialog>
  );
}
