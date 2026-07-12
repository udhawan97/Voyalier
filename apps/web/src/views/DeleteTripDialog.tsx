import { useRef, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
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
  // The required word is the localized placeholder, so the check always matches
  // the word the UI actually asks for (rather than a hardcoded English literal).
  const requiredWord = t("deleteTrip.placeholder").trim().toLowerCase();
  const ready = confirmText.trim().toLowerCase() === requiredWord;

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
      title={t("deleteTrip.title")}
      onClose={onClose}
      initialFocusRef={inputRef}
      description={t("deleteTrip.description", { title: trip.title })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            busy={submitting}
            disabled={!ready}
          >
            {t("deleteTrip.confirm")}
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
        label={t("deleteTrip.confirmLabel")}
        inputRef={inputRef}
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        autoComplete="off"
        placeholder={t("deleteTrip.placeholder")}
        hint={t("deleteTrip.hint")}
      />
    </Dialog>
  );
}
