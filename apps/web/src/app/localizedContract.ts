import type { RedactedField, WithheldField } from "@voyalier/contracts";

import { plural, t, type MessageKey } from "./i18n";

const REDACTED_KEYS: Record<RedactedField, MessageKey> = {
  "Confirmation codes": "contract.redacted.confirmationCodes",
  "Traveler names": "contract.redacted.travelerNames",
  Addresses: "contract.redacted.addresses",
};

export function redactedFieldLabel(field: RedactedField): string {
  return t(REDACTED_KEYS[field]);
}

export function withheldFieldLabel(field: WithheldField): string {
  return field === "Imported document text"
    ? t("contract.withheld.importedDocumentText")
    : redactedFieldLabel(field);
}

/** Translate the finite grounding phrases emitted by core without changing the exact payload preview. */
export function groundingLabel(value: string): string {
  const confirmed = /^(\d+) confirmed (flight|flights|stay|stays)$/.exec(value);
  if (confirmed) {
    const count = Number(confirmed[1]);
    return plural(
      confirmed[2].startsWith("flight")
        ? "assist.grounding.flight"
        : "assist.grounding.stay",
      count,
    );
  }
  const imported = /^(\d+) imported (document|documents)$/.exec(value);
  if (imported) {
    return plural("assist.grounding.document", Number(imported[1]));
  }
  if (value === "trip dates") return t("assist.grounding.tripDates");
  if (value === "no imported documents yet") {
    return t("assist.grounding.noDocuments");
  }
  return t("assist.grounding.confirmedEvidence");
}
