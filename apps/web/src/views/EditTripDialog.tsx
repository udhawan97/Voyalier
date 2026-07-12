import { useRef, useState } from "react";
import type { AppError, Trip, UpdateTripInput } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, tripFieldError } from "../app/format";
import { t } from "../app/i18n";
import { usePlaceSuggestions } from "../app/usePlaceSuggestions";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Combobox } from "../components/Combobox";
import { Dialog } from "../components/Dialog";
import { TextField } from "../components/fields";

interface FieldErrors {
  origin?: string;
  destination?: string;
  dates?: string;
}

/**
 * Edit a trip's core fields after creation. Reuses the same validation and place
 * suggestions as creation; imported documents, facts, and plans are untouched.
 */
export function EditTripDialog({
  trip,
  onClose,
  onUpdated,
}: {
  trip: Trip;
  onClose: () => void;
  onUpdated: (trip: Trip) => void;
}) {
  const gateway = useGateway();
  const [title, setTitle] = useState(trip.title);
  const [origin, setOrigin] = useState(trip.origin);
  const [destination, setDestination] = useState(trip.destination);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const originRef = useRef<HTMLInputElement>(null);
  const fetchPlaceSuggestions = usePlaceSuggestions();

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
    const patch: UpdateTripInput = {
      title: title.trim(),
      origin: origin.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
    };
    try {
      const updated = await gateway.updateTrip(trip.id, patch);
      onUpdated(updated);
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
      title={t("editTrip.title")}
      onClose={onClose}
      initialFocusRef={originRef}
      description={t("editTrip.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="edit-trip-form"
            busy={submitting}
          >
            {t("editTrip.submit")}
          </Button>
        </>
      }
    >
      <form
        id="edit-trip-form"
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
        <Combobox
          id="edit-trip-origin"
          label={t("createTrip.origin.label")}
          inputRef={originRef}
          value={origin}
          onChange={setOrigin}
          fetchSuggestions={fetchPlaceSuggestions}
          error={errors.origin}
          required
          maxLength={120}
          placeholder={t("createTrip.origin.placeholder")}
        />
        <Combobox
          id="edit-trip-destination"
          label={t("createTrip.destination.label")}
          value={destination}
          onChange={setDestination}
          fetchSuggestions={fetchPlaceSuggestions}
          error={errors.destination}
          required
          maxLength={120}
          placeholder={t("createTrip.destination.placeholder")}
        />
        <div className="voy-form__row">
          <TextField
            id="edit-trip-start"
            label={t("createTrip.startDate")}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
            aria-invalid={errors.dates ? true : undefined}
            aria-describedby={errors.dates ? "edit-trip-end-error" : undefined}
          />
          <TextField
            id="edit-trip-end"
            label={t("createTrip.endDate")}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={errors.dates}
            required
          />
        </div>
        <TextField
          id="edit-trip-title"
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
