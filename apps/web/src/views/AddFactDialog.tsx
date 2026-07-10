import { useState } from "react";
import type {
  AddManualFactInput,
  AppError,
  ConfirmedFact,
  FactType,
} from "@voyalier/contracts";

import { useGateway } from "../app/context";
import {
  describeError,
  draftToPayload,
  isDraftEmpty,
  type PayloadDraft,
} from "../app/format";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { Dialog } from "../components/Dialog";
import { FactPayloadForm } from "../components/FactPayloadForm";

export function AddFactDialog({
  tripId,
  onClose,
  onAdded,
}: {
  tripId: string;
  onClose: () => void;
  onAdded: (fact: ConfirmedFact) => void;
}) {
  const gateway = useGateway();
  const [factType, setFactType] = useState<FactType>("flight_segment");
  const [draft, setDraft] = useState<PayloadDraft>({});
  const [error, setError] = useState<AppError | null>(null);
  const [emptyError, setEmptyError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function switchType(next: FactType) {
    setFactType(next);
    setDraft({});
    setEmptyError(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (isDraftEmpty(factType, draft)) {
      setEmptyError(true);
      return;
    }
    setEmptyError(false);
    setSubmitting(true);
    const input: AddManualFactInput = {
      tripId,
      factType,
      payload: draftToPayload(factType, draft),
    };
    try {
      const fact = await gateway.addManualFact(input);
      onAdded(fact);
    } catch (caught) {
      setError(caught as AppError);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      title="Add a fact"
      onClose={onClose}
      description="Enter a flight or a stay by hand. Manual facts are yours and appear in the Blueprint right away."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="add-fact-form"
            busy={submitting}
          >
            Add to Blueprint
          </Button>
        </>
      }
    >
      <form
        id="add-fact-form"
        className="voy-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {error ? (
          <Banner tone="error" role="alert" title={describeError(error).title}>
            {describeError(error).body}
          </Banner>
        ) : null}
        <div className="voy-field">
          <span className="voy-field__label">Type</span>
          <ChoiceGroup
            label="Fact type"
            value={factType}
            onChange={switchType}
            options={[
              { value: "flight_segment", label: "Flight" },
              { value: "lodging_stay", label: "Stay" },
            ]}
          />
        </div>
        {emptyError ? (
          <p className="voy-field__error" role="alert">
            Add at least one detail before saving.
          </p>
        ) : null}
        <FactPayloadForm
          factType={factType}
          draft={draft}
          onChange={setDraft}
          idPrefix="add-fact"
        />
      </form>
    </Dialog>
  );
}
