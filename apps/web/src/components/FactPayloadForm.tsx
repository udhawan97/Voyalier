import type { FactType } from "@voyalier/contracts";

import {
  fieldInputType,
  fieldLabel,
  fieldsForType,
  type PayloadDraft,
} from "../app/format";
import { TextField } from "./fields";

interface FactPayloadFormProps {
  factType: FactType;
  draft: PayloadDraft;
  onChange: (draft: PayloadDraft) => void;
  idPrefix: string;
}

/** Editable field grid for a fact payload — shared by add-fact and edit-in-review. */
export function FactPayloadForm({
  factType,
  draft,
  onChange,
  idPrefix,
}: FactPayloadFormProps) {
  return (
    <div className="voy-payload-form">
      {fieldsForType(factType).map((key) => (
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
      ))}
    </div>
  );
}
