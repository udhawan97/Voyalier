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

// Lodging fields that get local suggestions (pack place names + prior stays).
const SUGGESTED_FIELDS = new Set<string>(["propertyName", "address"]);

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
          detail: t(`suggest.source.${suggestion.source}`),
        }));
      },
    [gateway, tripId],
  );

  return (
    <div className="voy-payload-form">
      {fieldsForType(factType).map((key) =>
        factType === "lodging_stay" && SUGGESTED_FIELDS.has(key) ? (
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
            onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
            autoComplete="off"
          />
        ),
      )}
    </div>
  );
}
