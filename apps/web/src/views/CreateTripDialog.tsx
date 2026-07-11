import { useRef, useState } from "react";
import type { AppError, CreateTripInput, Trip } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, tripFieldError } from "../app/format";
import { t } from "../app/i18n";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { TextField } from "../components/fields";

interface FieldErrors {
  origin?: string;
  destination?: string;
  dates?: string;
}

export function CreateTripDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}) {
  const gateway = useGateway();
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const originRef = useRef<HTMLInputElement>(null);

  // Client validation mirrors the contract: trimmed non-empty ≤120, start ≤ end.
  function validate(): FieldErrors {
    const next: FieldErrors = {};
    const trimmedOrigin = origin.trim();
    const trimmedDestination = destination.trim();
    if (!trimmedOrigin) next.origin = t("createTrip.origin.required");
    else if (trimmedOrigin.length > 120) next.origin = t("createTrip.tooLong");
    if (!trimmedDestination)
      next.destination = t("createTrip.destination.required");
    else if (trimmedDestination.length > 120)
      next.destination = t("createTrip.tooLong");
    if (!startDate || !endDate) next.dates = t("createTrip.dates.required");
    else if (startDate > endDate) next.dates = t("createTrip.dates.order");
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    const input: CreateTripInput = {
      origin: origin.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
    };
    const trimmedTitle = title.trim();
    if (trimmedTitle) input.title = trimmedTitle;

    try {
      const trip = await gateway.createTrip(input);
      onCreated(trip);
    } catch (caught) {
      const appError = caught as AppError;
      const mapped = tripFieldError(appError);
      if (mapped) {
        const key =
          mapped.field === "origin" || mapped.field === "destination"
            ? mapped.field
            : "dates";
        setErrors({ [key]: mapped.message });
      } else {
        setFormError(appError);
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      title={t("createTrip.title")}
      onClose={onClose}
      initialFocusRef={originRef}
      description={t("createTrip.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="create-trip-form"
            busy={submitting}
          >
            {t("createTrip.submit")}
          </Button>
        </>
      }
    >
      <form
        id="create-trip-form"
        className="voy-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {formError ? (
          <Banner
            tone="error"
            role="alert"
            title={describeError(formError).title}
          >
            {describeError(formError).body}
          </Banner>
        ) : null}
        <TextField
          id="trip-origin"
          label={t("createTrip.origin.label")}
          inputRef={originRef}
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          error={errors.origin}
          required
          maxLength={120}
          autoComplete="off"
          placeholder={t("createTrip.origin.placeholder")}
        />
        <TextField
          id="trip-destination"
          label={t("createTrip.destination.label")}
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          error={errors.destination}
          required
          maxLength={120}
          autoComplete="off"
          placeholder={t("createTrip.destination.placeholder")}
        />
        <div className="voy-form__row">
          <TextField
            id="trip-start"
            label={t("createTrip.startDate")}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
            aria-invalid={errors.dates ? true : undefined}
            aria-describedby={errors.dates ? "trip-end-error" : undefined}
          />
          <TextField
            id="trip-end"
            label={t("createTrip.endDate")}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={errors.dates}
            required
          />
        </div>
        <TextField
          id="trip-title"
          label={t("createTrip.name.label")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          autoComplete="off"
          hint={t("createTrip.name.hint")}
          placeholder={t("createTrip.name.placeholder")}
        />
      </form>
    </Dialog>
  );
}
