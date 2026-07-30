import { useCallback } from "react";
import type { FactType, SuggestableField } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import {
  fieldInputType,
  fieldLabel,
  fieldsForType,
  type PayloadDraft,
} from "../app/format";
import { t } from "../app/i18n";
import { Combobox, type ComboboxItem } from "./Combobox";
import { TextField } from "./fields";

interface FactPayloadFormProps {
  factType: FactType;
  draft: PayloadDraft;
  onChange: (draft: PayloadDraft) => void;
  idPrefix: string;
  /** The trip these values belong to, for local field-value suggestions. */
  tripId: string;
}

// Fields that get local suggestions, per fact type. Lodging draws on pack place
// names and prior stays; flights on the bundled offline airport list.
const SUGGESTED_FIELDS: Partial<Record<FactType, ReadonlySet<string>>> = {
  lodging_stay: new Set(["propertyName", "address"]),
  flight_segment: new Set(["departureAirportIata", "arrivalAirportIata"]),
};

/** Editable field grid for a fact payload — shared by add-fact and edit-in-review. */
export function FactPayloadForm({
  factType,
  draft,
  onChange,
  idPrefix,
  tripId,
}: FactPayloadFormProps) {
  const gateway = useGateway();

  const fetchFor = useCallback(
    (field: SuggestableField) =>
      async (query: string): Promise<ComboboxItem[]> => {
        const results = await gateway.suggestFieldValues({
          tripId,
          field,
          query,
        });
        return results.map((suggestion) => ({
          value: suggestion.value,
          // Airports carry the airport's name, which is the only readable part
          // of a row whose value is three letters. Every other source's detail
          // is untranslated English from the engine, so those keep the
          // localized source label instead.
          detail:
            suggestion.source === "airport" && suggestion.detail
              ? suggestion.detail
              : t(`suggest.source.${suggestion.source}`),
        }));
      },
    [gateway, tripId],
  );

  return (
    <div className="voy-payload-form">
      {fieldsForType(factType).map((key) =>
        SUGGESTED_FIELDS[factType]?.has(key) ? (
          <Combobox
            key={key}
            id={`${idPrefix}-${key}`}
            label={fieldLabel(key)}
            value={draft[key] ?? ""}
            onChange={(value) => onChange({ ...draft, [key]: value })}
            fetchSuggestions={fetchFor(key as SuggestableField)}
          />
        ) : (
          <TextField
            key={key}
            id={`${idPrefix}-${key}`}
            label={fieldLabel(key)}
            type={fieldInputType(key)}
            value={draft[key] ?? ""}
            onChange={(event) =>
              onChange({ ...draft, [key]: event.target.value })
            }
            autoComplete="off"
          />
        ),
      )}
    </div>
  );
}
