import { useRef, useState } from "react";
import type { AppError, CreateTripInput, Trip } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, tripFieldError } from "../app/format";
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
    if (!trimmedOrigin) next.origin = "Enter where the trip starts.";
    else if (trimmedOrigin.length > 120)
      next.origin = "Keep this under 120 characters.";
    if (!trimmedDestination) next.destination = "Enter where the trip goes.";
    else if (trimmedDestination.length > 120)
      next.destination = "Keep this under 120 characters.";
    if (!startDate || !endDate) next.dates = "Add both a start and end date.";
    else if (startDate > endDate)
      next.dates = "The start date must be on or before the end date.";
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
      title="Create a trip"
      onClose={onClose}
      initialFocusRef={originRef}
      description="Start with where you're going and when. Everything else can come later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="create-trip-form"
            busy={submitting}
          >
            Create trip
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
          label="From"
          inputRef={originRef}
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          error={errors.origin}
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Chicago"
        />
        <TextField
          id="trip-destination"
          label="To"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          error={errors.destination}
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Kyoto"
        />
        <div className="voy-form__row">
          <TextField
            id="trip-start"
            label="Start date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
            aria-invalid={errors.dates ? true : undefined}
          />
          <TextField
            id="trip-end"
            label="End date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={errors.dates}
            required
          />
        </div>
        <TextField
          id="trip-title"
          label="Trip name (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          autoComplete="off"
          hint="Defaults to “From → To”."
          placeholder="Kyoto autumn journey"
        />
      </form>
    </Dialog>
  );
}
