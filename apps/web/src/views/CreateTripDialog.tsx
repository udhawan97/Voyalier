import { useRef, useState, type RefObject } from "react";
import type {
  AppError,
  CreateTripInput,
  Trip,
  TripIntentDraft,
} from "@voyalier/contracts";
import { MAX_LOCATION_LEN, countChars } from "@voyalier/contracts";

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
  partySize?: string;
}

export function CreateTripDialog({
  onClose,
  onCreated,
  onDraftSaved,
  returnFocusRef,
}: {
  onClose: () => void;
  onCreated: (trip: Trip) => void;
  onDraftSaved: (draft: TripIntentDraft) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const gateway = useGateway();
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const originRef = useRef<HTMLInputElement>(null);
  const fetchPlaceSuggestions = usePlaceSuggestions();

  // Client validation mirrors the contract: trimmed non-empty within
  // MAX_LOCATION_LEN, start ≤ end. Counted with countChars, never `.length` —
  // the doc block above MAX_LOCATION_LEN names this exact failure: `.length`
  // counts UTF-16 units, so a name carrying astral characters counted double
  // and this form refused input the engine accepts.
  function validate(requireDates = true): FieldErrors {
    const next: FieldErrors = {};
    const trimmedOrigin = origin.trim();
    const trimmedDestination = destination.trim();
    if (!trimmedOrigin) next.origin = t("createTrip.origin.required");
    else if (countChars(trimmedOrigin) > MAX_LOCATION_LEN)
      next.origin = t("createTrip.tooLong");
    if (!trimmedDestination)
      next.destination = t("createTrip.destination.required");
    else if (countChars(trimmedDestination) > MAX_LOCATION_LEN)
      next.destination = t("createTrip.tooLong");
    if (requireDates && (!startDate || !endDate))
      next.dates = t("createTrip.dates.required");
    else if (Boolean(startDate) !== Boolean(endDate))
      next.dates = "Set both dates or leave both undecided.";
    else if (startDate > endDate) next.dates = t("createTrip.dates.order");
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)
      next.partySize = "Enter between 1 and 20 travelers.";
    return next;
  }

  /**
   * Drop a field's error the moment that field becomes valid.
   *
   * Only fields that have already failed re-check: validating a field the
   * traveler has not finished filling in for the first time is nagging, not
   * help. Once one has argued back, though, it has to stop arguing as soon as
   * it is answered — holding "Enter where the trip starts." above the words
   * "San Francisco" until the next submit reads as a bug in the form.
   */
  function clearIfFixed(field: keyof FieldErrors, valid: boolean) {
    setErrors((current) =>
      current[field] && valid ? { ...current, [field]: undefined } : current,
    );
  }

  function withinLimit(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length > 0 && countChars(trimmed) <= MAX_LOCATION_LEN;
  }

  /**
   * Put the traveler on the first thing that needs fixing.
   *
   * The messages appeared and were announced, but focus stayed on the button
   * that had just refused, so a keyboard user had to walk backwards through the
   * whole form to reach the first one. Ordered by the form's reading order, not
   * by the shape of the error object.
   */
  function focusFirstInvalid(found: FieldErrors) {
    const first =
      (found.origin && "trip-origin") ||
      (found.destination && "trip-destination") ||
      (found.dates && "trip-start") ||
      (found.partySize && "trip-party-size");
    if (!first) return;
    document.getElementById(first)?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(found);
      return;
    }

    setSubmitting(true);
    const input: CreateTripInput = {
      origin: origin.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
    };
    const trimmedTitle = title.trim();
    if (trimmedTitle) input.title = trimmedTitle;

    let createdTrip: Trip | null = null;
    try {
      createdTrip = await gateway.createTrip(input);
      const workspace = await gateway.getConciergeWorkspace(createdTrip.id);
      await gateway.setConciergeProfile({
        ...workspace.profile,
        preferences: { ...workspace.profile.preferences, partySize },
      });
      onCreated(createdTrip);
    } catch (caught) {
      if (createdTrip) {
        // Keep a failed follow-up profile write from leaving an unexpected trip
        // behind. The server owns cascade cleanup for the new draft trip.
        await gateway.deleteTrip(createdTrip.id).catch(() => undefined);
      }
      const appError = caught as AppError;
      const mapped = tripFieldError(appError);
      if (mapped) {
        const key =
          mapped.field === "origin" || mapped.field === "destination"
            ? mapped.field
            : "dates";
        const rejected = { [key]: mapped.message } as FieldErrors;
        setErrors(rejected);
        focusFirstInvalid(rejected);
      } else {
        setFormError(appError);
      }
      setSubmitting(false);
    }
  }

  async function saveDraft() {
    setFormError(null);
    const found = validate(false);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(found);
      return;
    }
    setSubmitting(true);
    try {
      const draft = await gateway.saveTripIntent({
        origin: origin.trim(),
        destination: destination.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        partySize,
      });
      onDraftSaved(draft);
    } catch (caught) {
      setFormError(caught as AppError);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      title={t("createTrip.title")}
      onClose={onClose}
      initialFocusRef={originRef}
      returnFocusRef={returnFocusRef}
      description={t("createTrip.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button variant="secondary" busy={submitting} onClick={saveDraft}>
            Save trip idea
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
        <Combobox
          id="trip-origin"
          label={t("createTrip.origin.label")}
          inputRef={originRef}
          value={origin}
          onChange={(value) => {
            setOrigin(value);
            clearIfFixed("origin", withinLimit(value));
          }}
          fetchSuggestions={fetchPlaceSuggestions}
          error={errors.origin}
          required
          placeholder={t("createTrip.origin.placeholder")}
        />
        <Combobox
          id="trip-destination"
          label={t("createTrip.destination.label")}
          value={destination}
          onChange={(value) => {
            setDestination(value);
            clearIfFixed("destination", withinLimit(value));
          }}
          fetchSuggestions={fetchPlaceSuggestions}
          error={errors.destination}
          required
          placeholder={t("createTrip.destination.placeholder")}
        />
        <div className="voy-form__dates">
          <div className="voy-form__row">
            <TextField
              id="trip-start"
              label={t("createTrip.startDate")}
              type="date"
              value={startDate}
              onChange={(event) => {
                const next = event.target.value;
                setStartDate(next);
                clearIfFixed(
                  "dates",
                  Boolean(next && endDate && next <= endDate),
                );
              }}
              required
              aria-invalid={errors.dates ? true : undefined}
              aria-describedby={errors.dates ? "trip-dates-error" : undefined}
            />
            <TextField
              id="trip-end"
              label={t("createTrip.endDate")}
              type="date"
              value={endDate}
              onChange={(event) => {
                const next = event.target.value;
                setEndDate(next);
                clearIfFixed(
                  "dates",
                  Boolean(startDate && next && startDate <= next),
                );
              }}
              required
              aria-invalid={errors.dates ? true : undefined}
              aria-describedby={errors.dates ? "trip-dates-error" : undefined}
            />
          </div>
          {errors.dates ? (
            <p className="voy-field__error" id="trip-dates-error" role="alert">
              {errors.dates}
            </p>
          ) : null}
        </div>
        <TextField
          id="trip-party-size"
          label="Travelers"
          type="number"
          min={1}
          max={20}
          value={partySize}
          onChange={(event) => setPartySize(Number(event.target.value))}
          required
          aria-invalid={errors.partySize ? true : undefined}
          aria-describedby={
            errors.partySize ? "trip-party-size-error" : undefined
          }
        />
        {errors.partySize ? (
          <p
            className="voy-field__error"
            id="trip-party-size-error"
            role="alert"
          >
            {errors.partySize}
          </p>
        ) : null}
        {/* This one keeps its maxLength, unlike origin and destination above.
            `validate_create_trip` does not bound the title at all — it only
            trims it — so the attribute is the whole limit here, and removing it
            would leave nothing enforcing anything. */}
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
