import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  AppError,
  AreaStay,
  AttachmentSummary,
  ConciergeProfile,
  ConciergeTaskState,
  ConciergeWorkspace,
  CostState,
  CostTaxStatus,
  DocumentSummary,
  ResidenceStatus,
  TravelerProfile,
  Trip,
} from "@voyalier/contracts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_WORKSPACE_BYTES,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import {
  conciergeScope,
  documentsScope,
  tripScope,
  useRevalidate,
  useScopeKey,
} from "../app/revalidate";
import {
  currencyMinorDigits,
  formatMinorAmount,
  minorAmountInput,
  parseMinorAmount,
} from "../app/money";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Skeleton } from "../components/primitives";

const TASK_LABELS: Record<ConciergeTaskState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  done_by_traveler: "You marked done",
  not_applicable: "Not applicable",
  needs_recheck: "Needs recheck",
};

const STATUS_LABELS: Record<ResidenceStatus, string> = {
  unknown: "Unknown",
  citizen: "Citizen",
  national: "National",
  permanent_resident: "Permanent resident",
  temporary_worker: "Temporary worker",
  student: "Student",
  visitor: "Visitor",
  other: "Other",
};

function localId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}_${suffix}`;
}

function copyText(value: string, setCopied: (value: string | null) => void) {
  const write = navigator.clipboard?.writeText(value);
  if (!write) return;
  void write.then(() => {
    setCopied(value);
    globalThis.setTimeout(() => setCopied(null), 2500);
  });
}

function SetupPanel({
  profile,
  onChange,
  onSave,
  busy,
}: {
  profile: ConciergeProfile;
  onChange: (profile: ConciergeProfile) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const preferences = profile.preferences;
  const update = (patch: Partial<typeof preferences>) =>
    onChange({
      ...profile,
      preferences: { ...preferences, ...patch },
    });
  return (
    <section className="voy-concierge__setup" id="concierge-people">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Ask once, use everywhere</p>
          <h3>Trip setup</h3>
        </div>
        <Button variant="primary" busy={busy} onClick={onSave}>
          Save setup
        </Button>
      </div>
      <div className="voy-concierge__fields">
        <label className="voy-field">
          <span className="voy-field__label">Island or neighborhood</span>
          <input
            className="voy-input"
            value={preferences.selectedArea ?? ""}
            placeholder="Undecided is okay"
            onChange={(event) =>
              update({ selectedArea: event.target.value || undefined })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Travelers</span>
          <input
            className="voy-input"
            type="number"
            min={1}
            max={20}
            value={preferences.partySize}
            onChange={(event) =>
              update({ partySize: Number(event.target.value) })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Adults</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            max={20}
            value={preferences.adults ?? ""}
            placeholder="Unknown"
            onChange={(event) =>
              update({
                adults:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Children</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            max={20}
            value={preferences.children ?? ""}
            placeholder="Unknown"
            onChange={(event) =>
              update({
                children:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Bedrooms</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            max={20}
            value={preferences.bedrooms ?? ""}
            placeholder="Enter on provider"
            onChange={(event) =>
              update({
                bedrooms:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Rooms</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            max={20}
            value={preferences.rooms ?? ""}
            placeholder="Unknown"
            onChange={(event) =>
              update({
                rooms:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Beds</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            max={40}
            value={preferences.beds ?? ""}
            placeholder="Unknown"
            onChange={(event) =>
              update({
                beds:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Pace</span>
          <select
            className="voy-input"
            value={preferences.pace}
            onChange={(event) =>
              update({ pace: event.target.value as typeof preferences.pace })
            }
          >
            <option value="unset">Undecided</option>
            <option value="slow">Slow</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full days</option>
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Driving</span>
          <select
            className="voy-input"
            value={preferences.carPreference}
            onChange={(event) =>
              update({
                carPreference: event.target
                  .value as typeof preferences.carPreference,
              })
            }
          >
            <option value="unset">Undecided</option>
            <option value="avoid">Avoid a car</option>
            <option value="open">Open to a car</option>
            <option value="prefer">Prefer a car</option>
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Travel mode</span>
          <select
            className="voy-input"
            value={preferences.travelMode ?? "unknown"}
            onChange={(event) =>
              update({
                travelMode: event.target.value as typeof preferences.travelMode,
              })
            }
          >
            <option value="unknown">Undecided</option>
            <option value="air">Air</option>
            <option value="land">Land</option>
            <option value="sea">Sea</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Foreign connection</span>
          <select
            className="voy-input"
            value={
              preferences.hasForeignConnection === undefined
                ? "unknown"
                : preferences.hasForeignConnection
                  ? "yes"
                  : "no"
            }
            onChange={(event) =>
              update({
                hasForeignConnection:
                  event.target.value === "unknown"
                    ? undefined
                    : event.target.value === "yes",
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="no">No, every segment stays domestic</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Trip purpose</span>
          <select
            className="voy-input"
            value={preferences.purpose ?? "unknown"}
            onChange={(event) =>
              update({
                purpose: event.target.value as typeof preferences.purpose,
              })
            }
          >
            <option value="unknown">Undecided</option>
            <option value="tourism">Tourism</option>
            <option value="business">Business</option>
            <option value="visit">Visit</option>
            <option value="study">Study</option>
            <option value="other">Other</option>
          </select>
        </label>
        {[
          ["kitchenRequired", "Kitchen required"],
          ["laundryRequired", "Laundry required"],
          ["airConditioningRequired", "Air conditioning required"],
          ["accessibilityRequired", "Accessibility features required"],
          ["flexibleCancellationPreferred", "Flexible cancellation preferred"],
        ].map(([field, label]) => (
          <label className="voy-field voy-field--check" key={field}>
            <input
              type="checkbox"
              checked={Boolean(preferences[field as keyof typeof preferences])}
              onChange={(event) => update({ [field]: event.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
        <label className="voy-field">
          <span className="voy-field__label">Planning currency</span>
          <input
            className="voy-input"
            value={preferences.baseCurrency}
            maxLength={3}
            onChange={(event) =>
              update({ baseCurrency: event.target.value.toUpperCase() })
            }
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Budget from</span>
          <input
            key={`budget-min-${preferences.baseCurrency}-${preferences.budgetMinMinor ?? ""}`}
            className="voy-input"
            inputMode="decimal"
            defaultValue={
              preferences.budgetMinMinor === undefined
                ? ""
                : minorAmountInput(
                    preferences.budgetMinMinor,
                    preferences.baseCurrency,
                  )
            }
            placeholder="Optional"
            aria-invalid={budgetError ? true : undefined}
            onBlur={(event) => {
              try {
                update({
                  budgetMinMinor:
                    event.target.value === ""
                      ? undefined
                      : parseMinorAmount(
                          event.target.value,
                          preferences.baseCurrency,
                        ),
                });
                setBudgetError(null);
              } catch (caught) {
                setBudgetError((caught as Error).message);
              }
            }}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Budget to</span>
          <input
            key={`budget-max-${preferences.baseCurrency}-${preferences.budgetMaxMinor ?? ""}`}
            className="voy-input"
            inputMode="decimal"
            defaultValue={
              preferences.budgetMaxMinor === undefined
                ? ""
                : minorAmountInput(
                    preferences.budgetMaxMinor,
                    preferences.baseCurrency,
                  )
            }
            placeholder="Optional"
            aria-invalid={budgetError ? true : undefined}
            onBlur={(event) => {
              try {
                update({
                  budgetMaxMinor:
                    event.target.value === ""
                      ? undefined
                      : parseMinorAmount(
                          event.target.value,
                          preferences.baseCurrency,
                        ),
                });
                setBudgetError(null);
              } catch (caught) {
                setBudgetError((caught as Error).message);
              }
            }}
          />
        </label>
        {budgetError ? (
          <p className="voy-field__error" role="alert">
            {budgetError}
          </p>
        ) : null}
        <label className="voy-field voy-field--check">
          <input
            type="checkbox"
            checked={preferences.budgetIsPerPerson}
            onChange={(event) =>
              update({ budgetIsPerPerson: event.target.checked })
            }
          />
          <span>Budget is per person</span>
        </label>
      </div>
    </section>
  );
}

function PeoplePanel({
  profile,
  onSave,
  busy,
}: {
  profile: ConciergeProfile;
  onSave: (profile: ConciergeProfile) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState({
    displayName: "",
    passport: "",
    residence: "US",
    status: "unknown" as ResidenceStatus,
    returnCountry: "US",
    existingDocument: "unknown" as const,
  });
  function add(event: FormEvent) {
    event.preventDefault();
    const traveler: TravelerProfile = {
      id: localId("traveler"),
      displayName: draft.displayName.trim(),
      passportCountryIso2: draft.passport || undefined,
      residenceCountryIso2: draft.residence || undefined,
      residenceStatus: draft.status,
      returnCountryIso2: draft.returnCountry || undefined,
      existingDestinationDocument: draft.existingDocument,
    };
    onSave({ ...profile, travelers: [...profile.travelers, traveler] });
    setDraft({
      displayName: "",
      passport: "",
      residence: "US",
      status: "unknown",
      returnCountry: "US",
      existingDocument: "unknown",
    });
  }
  return (
    <section className="voy-concierge__people" aria-labelledby="people-title">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Private local profiles</p>
          <h3 id="people-title">People</h3>
        </div>
        <span className="voy-concierge__counter">
          {profile.travelers.length} of {profile.preferences.partySize}
        </span>
      </div>
      {profile.travelers.length ? (
        <ul className="voy-concierge__people-list">
          {profile.travelers.map((traveler) => (
            <li key={traveler.id}>
              <span className="voy-concierge__avatar" aria-hidden="true">
                {traveler.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{traveler.displayName}</strong>
                <small>
                  {traveler.passportCountryIso2 ?? "Document unknown"} ·{" "}
                  {STATUS_LABELS[traveler.residenceStatus]}
                </small>
              </span>
              <button
                type="button"
                className="voy-linkbtn"
                disabled={busy}
                onClick={() =>
                  onSave({
                    ...profile,
                    travelers: profile.travelers.filter(
                      (item) => item.id !== traveler.id,
                    ),
                    walletLinks: profile.walletLinks.map((link) => ({
                      ...link,
                      travelerIds: link.travelerIds.filter(
                        (id) => id !== traveler.id,
                      ),
                    })),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="voy-concierge__emptycopy">
          Add readable labels such as “Me” or “Traveler 2.” Do not enter
          passport numbers.
        </p>
      )}
      {profile.travelers.length < profile.preferences.partySize ? (
        <form className="voy-concierge__inline-form" onSubmit={add}>
          <label className="voy-field">
            <span className="voy-field__label">Name in this trip</span>
            <input
              className="voy-input"
              required
              value={draft.displayName}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
            />
          </label>
          <label className="voy-field">
            <span className="voy-field__label">Return or onward country</span>
            <input
              className="voy-input"
              placeholder="US"
              maxLength={2}
              value={draft.returnCountry}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  returnCountry: event.target.value.toUpperCase(),
                })
              }
            />
          </label>
          <label className="voy-field">
            <span className="voy-field__label">
              Existing destination document
            </span>
            <select
              className="voy-input"
              value={draft.existingDocument}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  existingDocument: event.target
                    .value as typeof draft.existingDocument,
                })
              }
            >
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="voy-field">
            <span className="voy-field__label">Passport country</span>
            <input
              className="voy-input"
              aria-describedby="people-country-hint"
              placeholder="US, IN…"
              maxLength={2}
              value={draft.passport}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  passport: event.target.value.toUpperCase(),
                })
              }
            />
          </label>
          <label className="voy-field">
            <span className="voy-field__label">Residence country</span>
            <input
              className="voy-input"
              placeholder="US"
              maxLength={2}
              value={draft.residence}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  residence: event.target.value.toUpperCase(),
                })
              }
            />
          </label>
          <label className="voy-field">
            <span className="voy-field__label">Status category</span>
            <select
              className="voy-input"
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as ResidenceStatus,
                })
              }
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="voy-field__hint" id="people-country-hint">
            Country and broad status only. Voyalier never needs an ID number
            here.
          </p>
          <Button type="submit" busy={busy}>
            Add person
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function ProviderPanel({
  workspace,
  onSaved,
  onImport,
}: {
  workspace: ConciergeWorkspace;
  onSaved: (workspace: ConciergeWorkspace) => void;
  onImport: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [copied, setCopied] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  async function saveHandoff(
    action: ConciergeWorkspace["providerActions"][number],
  ) {
    setBusyId(action.id);
    setError(null);
    try {
      const next = {
        ...workspace.profile,
        providerHandoffs: [
          ...(workspace.profile.providerHandoffs ?? []),
          {
            id: localId("handoff"),
            providerActionId: action.id,
            provider: action.provider,
            url: action.url,
            searchBrief: action.searchBrief,
            openedAt: new Date().toISOString(),
            state: "considering" as const,
          },
        ],
      };
      const saved = await gateway.setConciergeProfile(next);
      onSaved(saved);
      setReadyUrl(action.url);
      announce(`${action.provider} handoff saved. The provider link is ready.`);
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setBusyId(null);
    }
  }
  async function setHandoffState(
    handoffId: string,
    state: "saved" | "user_reported_booked",
  ) {
    setBusyId(handoffId);
    try {
      const saved = await gateway.setConciergeProfile({
        ...workspace.profile,
        providerHandoffs: (workspace.profile.providerHandoffs ?? []).map(
          (handoff) =>
            handoff.id === handoffId ? { ...handoff, state } : handoff,
        ),
      });
      onSaved(saved);
      announce(
        state === "saved"
          ? "Candidate saved for comparison."
          : "Traveler-reported booking saved; import the confirmation for review.",
      );
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setBusyId(null);
    }
  }
  return (
    <section id="concierge-book" aria-labelledby="provider-title">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Compare elsewhere, return with evidence</p>
          <h3 id="provider-title">Book and discover</h3>
        </div>
      </div>
      <p className="voy-concierge__notice">
        Prices, availability, ratings and account details stay on each provider.
        Voyalier carries the brief and tells you what still needs entry.
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
      <div className="voy-concierge__providers">
        {workspace.providerActions.map((action) => (
          <article key={action.id} className="voy-concierge__provider">
            <div>
              <span className="voy-concierge__provider-name">
                {action.provider}
              </span>
              <span className="voy-badge">
                {action.verification.replaceAll("_", " ")}
              </span>
              <span className="voy-badge">
                {action.acquisition.replaceAll("_", " ")}
              </span>
            </div>
            <h4>{action.label}</h4>
            <p>{action.reason}</p>
            <dl>
              <div>
                <dt>Carried over</dt>
                <dd>{action.transferredFields.join(", ") || "Nothing yet"}</dd>
              </div>
              <div>
                <dt>Enter there</dt>
                <dd>{action.remainingFields.join(", ")}</dd>
              </div>
            </dl>
            <p className="voy-concierge__brief">{action.searchBrief}</p>
            <div className="voy-concierge__provider-actions">
              <Button
                variant="secondary"
                onClick={() => copyText(action.searchBrief, setCopied)}
              >
                {copied === action.searchBrief ? "Copied" : "Copy details"}
              </Button>
              <Button
                variant="primary"
                busy={busyId === action.id}
                onClick={() => void saveHandoff(action)}
              >
                Prepare {action.provider}
              </Button>
              {readyUrl === action.url ? (
                <a
                  className="voy-btn voy-btn--primary"
                  href={action.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span>Open {action.provider}</span>
                  <span className="voy-sr-only"> Opens in a new tab</span>
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {(workspace.profile.providerHandoffs ?? []).length ? (
        <div className="voy-concierge__handoffs">
          <h4>Provider return desk</h4>
          <p>
            Opening a provider never proves a purchase. Record what happened,
            then import a confirmation for Voyalier’s review flow.
          </p>
          <ul className="voy-concierge__wallet-list">
            {(workspace.profile.providerHandoffs ?? []).map((handoff) => (
              <li key={handoff.id}>
                <span>
                  <strong>{handoff.provider}</strong>
                  <small>{handoff.state.replaceAll("_", " ")}</small>
                </span>
                <span className="voy-concierge__attachment-actions">
                  <Button
                    variant="secondary"
                    busy={busyId === handoff.id}
                    onClick={() => void setHandoffState(handoff.id, "saved")}
                  >
                    Save candidate
                  </Button>
                  <Button
                    variant="secondary"
                    busy={busyId === handoff.id}
                    onClick={() =>
                      void setHandoffState(handoff.id, "user_reported_booked")
                    }
                  >
                    I booked it
                  </Button>
                  <Button variant="primary" onClick={onImport}>
                    Import confirmation
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PreparationPanel({
  workspace,
  onSetTask,
  busy,
}: {
  workspace: ConciergeWorkspace;
  onSetTask: (taskId: string, state: ConciergeTaskState) => void;
  busy: boolean;
}) {
  const people = new Map(
    workspace.profile.travelers.map((traveler) => [
      traveler.id,
      traveler.displayName,
    ]),
  );
  return (
    <section id="concierge-entry" aria-labelledby="preparation-title">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Per person, per route</p>
          <h3 id="preparation-title">Entry and return</h3>
        </div>
        <a className="voy-linkbtn" href="#section-visa">
          Open the detailed entry checklist
        </a>
      </div>
      {workspace.preparationSteps.length ? (
        <ol className="voy-concierge__steps">
          {workspace.preparationSteps.map((step) => (
            <li key={step.id}>
              <span className="voy-concierge__step-person">
                {people.get(step.travelerId) ?? "Traveler"}
              </span>
              <h4>{step.title}</h4>
              <p>{step.applicability}</p>
              <p>
                <strong>Next:</strong> {step.nextAction}
              </p>
              {step.prerequisiteIds.length ? (
                <p>
                  <strong>After:</strong> {step.prerequisiteIds.join(", ")}
                </p>
              ) : null}
              {step.documentRequirements.map((document) => (
                <p key={document.id}>
                  <strong>{document.label}</strong> ·{" "}
                  {document.status.replaceAll("_", " ")}
                  {document.linkedWalletLinkIds.length
                    ? ` · ${document.linkedWalletLinkIds.length} linked wallet item(s)`
                    : " · not linked yet"}
                </p>
              ))}
              <a
                href={step.authorityUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open {step.authorityName} · checked {step.sourceCheckedOn}
                <span className="voy-sr-only"> Opens in a new tab</span>
              </a>
              <label>
                <span className="voy-sr-only">Progress for {step.title}</span>
                <select
                  className="voy-input"
                  value={step.state}
                  disabled={busy}
                  onChange={(event) =>
                    onSetTask(step.id, event.target.value as ConciergeTaskState)
                  }
                >
                  {Object.entries(TASK_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ol>
      ) : (
        <p className="voy-concierge__emptycopy">
          Add traveler profiles to create sourced preparation steps. Unknown
          details stay unknown.
        </p>
      )}
    </section>
  );
}

function WalletPanel({
  tripId,
  profile,
  documents,
  attachments,
  preparationSteps,
  onSave,
  onImport,
  onAttachmentsChanged,
  busy,
}: {
  tripId: string;
  profile: ConciergeProfile;
  documents: DocumentSummary[];
  attachments: AttachmentSummary[];
  preparationSteps: ConciergeWorkspace["preparationSteps"];
  onSave: (profile: ConciergeProfile) => void;
  onImport: () => void;
  onAttachmentsChanged: () => void;
  busy: boolean;
}) {
  const gateway = useGateway();
  const revalidate = useRevalidate();
  const announce = useAnnounce();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("confirmation");
  const [sourceId, setSourceId] = useState("");
  const [travelerIds, setTravelerIds] = useState<string[]>([]);
  const [requirementId, setRequirementId] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    attachment: AttachmentSummary;
    url: string;
  } | null>(null);
  const mounted = useRef(true);
  const previewRequest = useRef(0);
  useEffect(
    () => () => {
      mounted.current = false;
      previewRequest.current += 1;
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const docs = new Map(
    documents.map((item) => [item.document.id, item.document]),
  );
  const files = new Map(attachments.map((item) => [item.id, item]));
  const attachmentBytes = attachments.reduce(
    (total, item) => total + item.byteCount,
    0,
  );
  function add(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...profile,
      walletLinks: [
        ...profile.walletLinks,
        {
          id: localId("wallet"),
          label: label.trim(),
          category,
          travelerIds,
          preparationRequirementIds: requirementId ? [requirementId] : [],
          sourceDocumentId: sourceId.startsWith("document:")
            ? sourceId.slice("document:".length)
            : undefined,
          sourceAttachmentId: sourceId.startsWith("attachment:")
            ? sourceId.slice("attachment:".length)
            : undefined,
          expiresOn: expiresOn || undefined,
          note: note.trim(),
        },
      ],
    });
    setLabel("");
    setSourceId("");
    setTravelerIds([]);
    setRequirementId("");
    setExpiresOn("");
    setNote("");
  }
  async function importFile(file: File) {
    setFileError(null);
    if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
      setFileError(
        file.size === 0
          ? "That file is empty."
          : "Choose a file no larger than 20 MiB.",
      );
      return;
    }
    if (attachmentBytes + file.size > MAX_ATTACHMENT_WORKSPACE_BYTES) {
      setFileError(
        "This trip alone would exceed the 500 MiB encrypted-wallet limit for the workspace. Remove a file before importing another so portable backup remains available.",
      );
      return;
    }
    setFileBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 32_768),
        );
      }
      const attachment = await gateway.importAttachment({
        tripId,
        label: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: btoa(binary),
      });
      onSave({
        ...profile,
        walletLinks: [
          ...profile.walletLinks,
          {
            id: localId("wallet"),
            label: file.name,
            category: file.type === "application/pdf" ? "travel file" : "image",
            travelerIds: [],
            preparationRequirementIds: [],
            sourceAttachmentId: attachment.id,
            note: "",
          },
        ],
      });
      onAttachmentsChanged();
      revalidate(conciergeScope(tripId), documentsScope(tripId));
      announce(`${file.name} encrypted and added to this trip.`);
    } catch (caught) {
      setFileError(describeError(caught as AppError).body);
    } finally {
      setFileBusy(false);
    }
  }
  async function downloadFile(attachment: AttachmentSummary) {
    setFileError(null);
    try {
      const content = await gateway.getAttachment(attachment.id);
      const binary = atob(content.contentBase64);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: attachment.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.label;
      anchor.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      setFileError(describeError(caught as AppError).body);
    }
  }
  async function previewFile(attachment: AttachmentSummary) {
    const request = ++previewRequest.current;
    setFileError(null);
    try {
      const content = await gateway.getAttachment(attachment.id);
      if (!mounted.current || request !== previewRequest.current) return;
      const binary = atob(content.contentBase64);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: attachment.mimeType }),
      );
      if (!mounted.current || request !== previewRequest.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setPreview({ attachment, url });
    } catch (caught) {
      if (mounted.current && request === previewRequest.current) {
        setFileError(describeError(caught as AppError).body);
      }
    }
  }
  function closePreview() {
    previewRequest.current += 1;
    setPreview(null);
  }
  async function deleteFile(attachment: AttachmentSummary) {
    if (!globalThis.confirm(`Remove ${attachment.label} from this trip?`))
      return;
    setFileError(null);
    try {
      await gateway.deleteAttachment(attachment.id);
      onAttachmentsChanged();
      revalidate(conciergeScope(tripId), documentsScope(tripId));
      announce(`${attachment.label} removed from this device.`);
    } catch (caught) {
      setFileError(describeError(caught as AppError).body);
    }
  }
  return (
    <section id="concierge-wallet" aria-labelledby="wallet-title">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Encrypted trip index</p>
          <h3 id="wallet-title">Document wallet</h3>
        </div>
        <div className="voy-concierge__wallet-actions">
          <Button variant="secondary" onClick={onImport}>
            Import confirmation
          </Button>
          <label className="voy-btn voy-btn--secondary">
            <span>{fileBusy ? "Encrypting…" : "Add PDF or image"}</span>
            <input
              className="voy-sr-only"
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              disabled={fileBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {fileError ? (
        <Banner tone="error" role="alert" title="File could not be stored">
          {fileError}
        </Banner>
      ) : null}
      {attachments.length ? (
        <>
          <p className="voy-concierge__storage">
            {attachments.length} encrypted file(s) ·{" "}
            {(attachmentBytes / (1024 * 1024)).toFixed(1)} MiB in this trip
            {" · 500 MiB workspace limit keeps portable backup available"}
          </p>
          <ul className="voy-concierge__attachments">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <span>
                  <strong>{attachment.label}</strong>
                  <small>
                    {attachment.mimeType} ·{" "}
                    {Math.ceil(attachment.byteCount / 1024)} KB · encrypted
                  </small>
                </span>
                <span className="voy-concierge__attachment-actions">
                  <button
                    type="button"
                    className="voy-linkbtn"
                    onClick={() => void previewFile(attachment)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="voy-linkbtn"
                    onClick={() => void downloadFile(attachment)}
                  >
                    Save a copy
                  </button>
                  <button
                    type="button"
                    className="voy-linkbtn"
                    onClick={() => void deleteFile(attachment)}
                  >
                    Remove file
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {profile.walletLinks.length ? (
        <ul className="voy-concierge__wallet-list">
          {profile.walletLinks.map((link) => (
            <li key={link.id}>
              <span>
                <strong>{link.label}</strong>
                <small>
                  {link.category}
                  {link.sourceDocumentId
                    ? ` · ${docs.get(link.sourceDocumentId)?.label ?? "Source removed"}`
                    : link.sourceAttachmentId
                      ? ` · ${files.get(link.sourceAttachmentId)?.label ?? "File removed"}`
                      : " · No imported source linked"}
                  {link.expiresOn ? ` · review by ${link.expiresOn}` : ""}
                </small>
                {link.travelerIds.length ? (
                  <small>
                    For{" "}
                    {link.travelerIds
                      .map(
                        (id) =>
                          profile.travelers.find((person) => person.id === id)
                            ?.displayName ?? "Traveler",
                      )
                      .join(", ")}
                  </small>
                ) : null}
                {link.preparationRequirementIds?.length ? (
                  <small>
                    Linked to {link.preparationRequirementIds.length}{" "}
                    preparation requirement(s)
                  </small>
                ) : null}
                {link.note ? <small>{link.note}</small> : null}
              </span>
              <button
                type="button"
                className="voy-linkbtn"
                disabled={busy}
                onClick={() =>
                  onSave({
                    ...profile,
                    walletLinks: profile.walletLinks.filter(
                      (item) => item.id !== link.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="voy-concierge__emptycopy">
          Link visas, ID reminders, insurance and confirmations to the evidence
          already stored in this trip.
        </p>
      )}
      <form className="voy-concierge__inline-form" onSubmit={add}>
        <label className="voy-field">
          <span className="voy-field__label">Wallet label</span>
          <input
            className="voy-input"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Category</span>
          <select
            className="voy-input"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="confirmation">Confirmation</option>
            <option value="identity">Identity reminder</option>
            <option value="entry">Entry or visa</option>
            <option value="insurance">Insurance</option>
            <option value="health">Health</option>
            <option value="other">Other</option>
          </select>
        </label>
        <fieldset className="voy-field voy-concierge__traveler-checks">
          <legend className="voy-field__label">People</legend>
          {profile.travelers.length ? (
            profile.travelers.map((traveler) => (
              <label key={traveler.id}>
                <input
                  type="checkbox"
                  checked={travelerIds.includes(traveler.id)}
                  onChange={(event) =>
                    setTravelerIds(
                      event.target.checked
                        ? [...travelerIds, traveler.id]
                        : travelerIds.filter((id) => id !== traveler.id),
                    )
                  }
                />
                <span>{traveler.displayName}</span>
              </label>
            ))
          ) : (
            <span className="voy-field__hint">
              Add people first if this item belongs to someone.
            </span>
          )}
        </fieldset>
        <label className="voy-field">
          <span className="voy-field__label">
            Preparation requirement (optional)
          </span>
          <select
            className="voy-input"
            value={requirementId}
            onChange={(event) => {
              const nextId = event.target.value;
              setRequirementId(nextId);
              const owner = preparationSteps.find((step) =>
                step.documentRequirements.some(
                  (requirement) => requirement.id === nextId,
                ),
              )?.travelerId;
              if (owner && !travelerIds.includes(owner)) {
                setTravelerIds([...travelerIds, owner]);
              }
            }}
          >
            <option value="">General wallet item</option>
            {preparationSteps.flatMap((step) =>
              step.documentRequirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {profile.travelers.find(
                    (traveler) => traveler.id === step.travelerId,
                  )?.displayName ?? "Traveler"}
                  : {requirement.label}
                </option>
              )),
            )}
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Review or expiry date</span>
          <input
            className="voy-input"
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Note</span>
          <input
            className="voy-input"
            value={note}
            maxLength={2000}
            placeholder="Optional; never enter document numbers"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Imported source</span>
          <select
            className="voy-input"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <option value="">No source yet</option>
            {documents.map(({ document }) => (
              <option key={document.id} value={`document:${document.id}`}>
                Link: {document.label}
              </option>
            ))}
            {attachments.map((attachment) => (
              <option key={attachment.id} value={`attachment:${attachment.id}`}>
                File: {attachment.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" busy={busy}>
          Add to wallet
        </Button>
      </form>
      {preview ? (
        <Dialog
          title={preview.attachment.label}
          size="lg"
          initialFocus="dialog"
          description="Temporary in-memory preview. Closing this view releases the decrypted copy."
          onClose={closePreview}
          footer={
            <Button variant="secondary" onClick={closePreview}>
              Close preview
            </Button>
          }
        >
          {preview.attachment.mimeType === "application/pdf" ? (
            <iframe
              className="voy-concierge__file-preview"
              title={`Preview of ${preview.attachment.label}`}
              sandbox=""
              src={preview.url}
            />
          ) : (
            <img
              className="voy-concierge__file-preview"
              src={preview.url}
              alt={`Preview of ${preview.attachment.label}`}
            />
          )}
        </Dialog>
      ) : null}
    </section>
  );
}

function MoneyPanel({
  workspace,
  onSave,
  busy,
}: {
  workspace: ConciergeWorkspace;
  onSave: (profile: ConciergeProfile) => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(
    workspace.profile.preferences.baseCurrency,
  );
  const [state, setState] = useState<CostState>("estimate");
  const [taxStatus, setTaxStatus] = useState<CostTaxStatus>("unknown");
  const [amountError, setAmountError] = useState<string | null>(null);
  function add(event: FormEvent) {
    event.preventDefault();
    let amountMinor: number | undefined;
    if (amount.trim()) {
      try {
        amountMinor = parseMinorAmount(amount, currency);
        setAmountError(null);
      } catch (caught) {
        setAmountError((caught as Error).message);
        return;
      }
    }
    onSave({
      ...workspace.profile,
      costs: [
        ...workspace.profile.costs,
        {
          id: localId("cost"),
          label: label.trim(),
          category: "trip",
          amountMinor,
          currency,
          state,
          taxStatus,
        },
      ],
    });
    setLabel("");
    setAmount("");
  }
  return (
    <section id="concierge-money" aria-labelledby="money-title">
      <div className="voy-concierge__section-head">
        <div>
          <p className="voy-eyebrow">Exact currencies, explicit status</p>
          <h3 id="money-title">Money</h3>
        </div>
      </div>
      <div className="voy-concierge__totals">
        {workspace.totals.length ? (
          workspace.totals.map((total) => (
            <article key={total.currency}>
              <strong>{total.currency}</strong>
              <span>
                {formatMinorAmount(total.estimatesMinor, total.currency)}{" "}
                estimated
              </span>
              <span>
                {formatMinorAmount(total.committedMinor, total.currency)}{" "}
                committed
              </span>
              <span>
                {formatMinorAmount(total.refundsMinor, total.currency)} refunds
              </span>
            </article>
          ))
        ) : (
          <p className="voy-concierge__emptycopy">
            Add known amounts. Taxes and fees can remain missing until a
            provider shows them.
          </p>
        )}
      </div>
      {workspace.profile.costs.length ? (
        <ul className="voy-concierge__wallet-list">
          {workspace.profile.costs.map((cost) => (
            <li key={cost.id}>
              <span>
                <strong>{cost.label}</strong>
                <small>
                  {cost.state} ·{" "}
                  {cost.amountMinor === undefined
                    ? "Amount not entered"
                    : formatMinorAmount(cost.amountMinor, cost.currency)}{" "}
                  · taxes {cost.taxStatus ?? "unknown"}
                </small>
              </span>
              <button
                type="button"
                className="voy-linkbtn"
                disabled={busy}
                onClick={() =>
                  onSave({
                    ...workspace.profile,
                    costs: workspace.profile.costs.filter(
                      (item) => item.id !== cost.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="voy-concierge__inline-form" onSubmit={add}>
        <label className="voy-field">
          <span className="voy-field__label">Item</span>
          <input
            className="voy-input"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Amount</span>
          <input
            className="voy-input"
            type="number"
            min={0}
            step={1 / 10 ** currencyMinorDigits(currency)}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={
              amountError ? "concierge-amount-error" : undefined
            }
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Unknown"
          />
        </label>
        {amountError ? (
          <p
            className="voy-field__error"
            id="concierge-amount-error"
            role="alert"
          >
            {amountError}
          </p>
        ) : null}
        <label className="voy-field">
          <span className="voy-field__label">Currency</span>
          <input
            className="voy-input"
            required
            maxLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Status</span>
          <select
            className="voy-input"
            value={state}
            onChange={(event) => setState(event.target.value as CostState)}
          >
            <option value="estimate">Estimate</option>
            <option value="committed">Committed</option>
            <option value="refund">Refund</option>
          </select>
        </label>
        <label className="voy-field">
          <span className="voy-field__label">Taxes and mandatory fees</span>
          <select
            className="voy-input"
            value={taxStatus}
            onChange={(event) =>
              setTaxStatus(event.target.value as CostTaxStatus)
            }
          >
            <option value="unknown">Unknown</option>
            <option value="included">Included in amount</option>
            <option value="extra">Extra amount still due</option>
          </select>
        </label>
        <Button type="submit" busy={busy}>
          Add amount
        </Button>
      </form>
    </section>
  );
}

function AreaStayRow({
  stay,
  onSave,
  onRemove,
  busy,
}: {
  stay: AreaStay;
  onSave: (stay: AreaStay) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [checkIn, setCheckIn] = useState(stay.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(stay.checkOut ?? "");
  const invalid = Boolean(checkIn) !== Boolean(checkOut) || checkOut < checkIn;
  return (
    <li className="voy-concierge__split-stay">
      <strong>{stay.area}</strong>
      <label className="voy-field">
        <span className="voy-field__label">Check-in</span>
        <input
          className="voy-input"
          type="date"
          value={checkIn}
          onChange={(event) => setCheckIn(event.target.value)}
        />
      </label>
      <label className="voy-field">
        <span className="voy-field__label">Check-out</span>
        <input
          className="voy-input"
          type="date"
          value={checkOut}
          onChange={(event) => setCheckOut(event.target.value)}
        />
      </label>
      <Button
        variant="secondary"
        busy={busy}
        disabled={invalid}
        onClick={() =>
          onSave({
            ...stay,
            checkIn: checkIn || undefined,
            checkOut: checkOut || undefined,
          })
        }
      >
        Save base dates
      </Button>
      <button
        type="button"
        className="voy-linkbtn"
        disabled={busy}
        onClick={onRemove}
      >
        Remove base
      </button>
      {invalid ? (
        <small role="alert">Set both dates with check-in first.</small>
      ) : null}
    </li>
  );
}

function CockpitEditor({
  trip,
  initial,
  documents,
  attachments,
  onImport,
  onAttachmentsChanged,
}: {
  trip: Trip;
  initial: ConciergeWorkspace;
  documents: DocumentSummary[];
  attachments: AttachmentSummary[];
  onImport: () => void;
  onAttachmentsChanged: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [optimisticWorkspace, setOptimisticWorkspace] = useState<{
    base: ConciergeWorkspace;
    value: ConciergeWorkspace;
  }>();
  // A trip-scope refresh can change confirmed facts or authored plans without
  // changing the concierge profile timestamp. Use every fresh projection as
  // soon as it arrives, while retaining an unsaved profile draft. A successful
  // concierge write is shown optimistically only until the parent supplies a
  // newer projection object.
  const workspace =
    optimisticWorkspace?.base === initial ? optimisticWorkspace.value : initial;
  const [profile, setProfile] = useState(initial.profile);
  const [atlasDepth, setAtlasDepth] = useState<"flat" | "relief">("relief");
  const saveAction = useAsyncAction(
    (next: ConciergeProfile) => gateway.setConciergeProfile(next),
    (saved) => {
      setOptimisticWorkspace({ base: initial, value: saved });
      setProfile(saved.profile);
      announce("Concierge plan saved on this device.");
    },
  );
  const progress = workspace.tasks.filter(
    (task) =>
      task.state === "done_by_traveler" || task.state === "not_applicable",
  ).length;
  const complete = workspace.tasks.length
    ? Math.round((progress / workspace.tasks.length) * 100)
    : 0;
  function save(next = profile) {
    void saveAction.run(next);
  }
  function setTask(taskId: string, state: ConciergeTaskState) {
    const previous = profile.taskProgress.find(
      (item) => item.taskId === taskId,
    );
    const next = {
      ...profile,
      taskProgress: [
        ...profile.taskProgress.filter((item) => item.taskId !== taskId),
        {
          ...previous,
          taskId,
          state,
          note: previous?.note ?? "",
          contextRevision:
            state === "done_by_traveler" || state === "not_applicable"
              ? trip.updatedAt
              : undefined,
        },
      ],
    };
    setProfile(next);
    save(next);
  }
  const activeTasks = workspace.tasks.filter(
    (task) =>
      task.state !== "done_by_traveler" && task.state !== "not_applicable",
  );
  const completedTasks = workspace.tasks.filter(
    (task) =>
      task.state === "done_by_traveler" || task.state === "not_applicable",
  );
  return (
    <section className="voy-concierge" aria-labelledby="concierge-title">
      <div className="voy-concierge__scene">
        <div
          className="voy-concierge__atlas"
          data-depth={atlasDepth}
          aria-hidden="true"
        >
          <span className="voy-concierge__origin">{trip.origin}</span>
          <span className="voy-concierge__route" />
          <span className="voy-concierge__destination">
            {profile.preferences.selectedArea ?? trip.destination}
          </span>
        </div>
        <header className="voy-concierge__header">
          <div>
            <p className="voy-eyebrow">Your travel workbench</p>
            <h2 id="concierge-title">Everything between here and there</h2>
            <p>
              Set the group once, follow the next actions, open the right
              external service, and bring the confirmation back to your private
              workspace.
            </p>
          </div>
          <div
            className="voy-concierge__progress"
            role="progressbar"
            aria-label="Traveler-reported concierge progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={complete}
            style={{ "--voy-progress": `${complete}%` } as CSSProperties}
          >
            <strong>{complete}%</strong>
            <span>You marked complete</span>
          </div>
        </header>
        <div className="voy-concierge__depth" aria-label="Atlas depth">
          <button
            type="button"
            aria-pressed={atlasDepth === "flat"}
            onClick={() => setAtlasDepth("flat")}
          >
            Flat
          </button>
          <button
            type="button"
            aria-pressed={atlasDepth === "relief"}
            onClick={() => setAtlasDepth("relief")}
          >
            Relief
          </button>
        </div>
      </div>

      {saveAction.error ? (
        <Banner
          tone="error"
          role="alert"
          title={describeError(saveAction.error).title}
        >
          {describeError(saveAction.error).body}
        </Banner>
      ) : null}

      <nav className="voy-concierge__nav" aria-label="Concierge sections">
        {[
          ["concierge-next", "Next"],
          ["concierge-people", "People"],
          ["concierge-book", "Book & explore"],
          ["concierge-entry", "Entry"],
          ["concierge-wallet", "Wallet"],
          ["concierge-money", "Money"],
        ].map(([target, label]) => (
          <a key={target} href={`#${target}`}>
            {label}
          </a>
        ))}
      </nav>

      <div className="voy-concierge__overview" id="concierge-next">
        <section aria-labelledby="next-actions-title">
          <p className="voy-eyebrow">Ordered by what blocks the trip</p>
          <h3 id="next-actions-title">Next actions</h3>
          <ol className="voy-concierge__tasks">
            {activeTasks.map((task, index) => (
              <li key={task.id}>
                <span className="voy-concierge__task-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="voy-concierge__task-copy">
                  <strong>{task.title}</strong>
                  <span>{task.reason}</span>
                  <small>{task.authority} source</small>
                  {(profile.taskProgress.find((item) => item.taskId === task.id)
                    ?.history?.length ?? 0) > 0 ? (
                    <small>
                      {
                        profile.taskProgress.find(
                          (item) => item.taskId === task.id,
                        )!.history!.length
                      }{" "}
                      earlier state(s) retained
                    </small>
                  ) : null}
                </span>
                <label>
                  <span className="voy-sr-only">Progress for {task.title}</span>
                  <select
                    className="voy-input"
                    value={task.state}
                    disabled={saveAction.busy}
                    onChange={(event) =>
                      setTask(task.id, event.target.value as ConciergeTaskState)
                    }
                  >
                    {Object.entries(TASK_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <a className="voy-linkbtn" href={`#concierge-${task.section}`}>
                  Go to {task.section}
                </a>
              </li>
            ))}
          </ol>
          {completedTasks.length ? (
            <details className="voy-concierge__history">
              <summary>Completed history ({completedTasks.length})</summary>
              <ul>
                {completedTasks.map((task) => (
                  <li key={task.id}>
                    <span>
                      {task.title}
                      {(profile.taskProgress.find(
                        (item) => item.taskId === task.id,
                      )?.history?.length ?? 0) > 0
                        ? ` · ${profile.taskProgress.find((item) => item.taskId === task.id)!.history!.length} earlier state(s)`
                        : ""}
                    </span>
                    <button
                      type="button"
                      className="voy-linkbtn"
                      onClick={() => setTask(task.id, "in_progress")}
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
        <aside className="voy-concierge__daykit">
          <p className="voy-eyebrow">Travel-day kit</p>
          <h3>Open in two steps</h3>
          <ul>
            <li>
              {documents.length + attachments.length} imported document(s)
            </li>
            <li>{profile.walletLinks.length} wallet link(s)</li>
            <li>{profile.travelers.length} traveler profile(s)</li>
            <li>{workspace.totals.length} tracked currency group(s)</li>
          </ul>
          <p>
            Download city packs before travel, keep official portal results in
            the wallet, and import every final confirmation for review.
          </p>
        </aside>
      </div>

      <SetupPanel
        profile={profile}
        onChange={setProfile}
        onSave={() => save()}
        busy={saveAction.busy}
      />
      <PeoplePanel profile={profile} onSave={save} busy={saveAction.busy} />
      {workspace.areaGuides.length ? (
        <section className="voy-concierge__areas" aria-labelledby="areas-title">
          <div className="voy-concierge__section-head">
            <div>
              <p className="voy-eyebrow">Compare the shape of the stay</p>
              <h3 id="areas-title">Areas and islands</h3>
            </div>
          </div>
          <div className="voy-concierge__providers">
            {workspace.areaGuides.map((area) => (
              <article key={area.id} className="voy-concierge__provider">
                <h4>{area.name}</h4>
                <p>{area.fit}</p>
                <p>
                  <strong>Tradeoff:</strong> {area.tradeoff}
                </p>
                <div className="voy-concierge__provider-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const next = {
                        ...profile,
                        preferences: {
                          ...profile.preferences,
                          selectedArea: area.name,
                        },
                      };
                      setProfile(next);
                      save(next);
                    }}
                  >
                    Choose {area.name}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={(profile.preferences.areaStays ?? []).some(
                      (stay) => stay.area === area.name,
                    )}
                    onClick={() => {
                      const next = {
                        ...profile,
                        preferences: {
                          ...profile.preferences,
                          areaStays: [
                            ...(profile.preferences.areaStays ?? []),
                            {
                              id: localId("base"),
                              area: area.name,
                            },
                          ],
                        },
                      };
                      setProfile(next);
                      save(next);
                    }}
                  >
                    Add {area.name} as a base
                  </Button>
                  <a
                    href={area.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Verify with {area.sourceName}
                  </a>
                </div>
              </article>
            ))}
          </div>
          {(profile.preferences.areaStays ?? []).length ? (
            <div className="voy-concierge__split-plan">
              <h4>Multi-area stay</h4>
              <p>
                Keep each base and transfer separate. A gap or overlap becomes a
                next action before booking.
              </p>
              <ol>
                {(profile.preferences.areaStays ?? []).map((stay) => (
                  <AreaStayRow
                    key={stay.id}
                    stay={stay}
                    busy={saveAction.busy}
                    onSave={(updated) => {
                      const next = {
                        ...profile,
                        preferences: {
                          ...profile.preferences,
                          areaStays: (profile.preferences.areaStays ?? []).map(
                            (item) => (item.id === updated.id ? updated : item),
                          ),
                        },
                      };
                      setProfile(next);
                      save(next);
                    }}
                    onRemove={() => {
                      const next = {
                        ...profile,
                        preferences: {
                          ...profile.preferences,
                          areaStays: (
                            profile.preferences.areaStays ?? []
                          ).filter((item) => item.id !== stay.id),
                        },
                      };
                      setProfile(next);
                      save(next);
                    }}
                  />
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}
      <ProviderPanel
        workspace={{ ...workspace, profile }}
        onSaved={(saved) => {
          setOptimisticWorkspace({ base: initial, value: saved });
          setProfile(saved.profile);
        }}
        onImport={onImport}
      />
      <PreparationPanel
        workspace={{ ...workspace, profile }}
        onSetTask={setTask}
        busy={saveAction.busy}
      />
      <section id="concierge-plan" className="voy-concierge__notice">
        <p className="voy-eyebrow">Local movement</p>
        <h3>Plan transfers around confirmed times</h3>
        <p>
          Use the transport handoffs above, then add transfers to the Journey
          Board. Estimated route lines are planning aids, not directions.
        </p>
        <a className="voy-linkbtn" href="#section-plan">
          Open the Journey Board
        </a>
      </section>
      <WalletPanel
        tripId={trip.id}
        profile={profile}
        documents={documents}
        attachments={attachments}
        preparationSteps={workspace.preparationSteps}
        onSave={save}
        onImport={onImport}
        onAttachmentsChanged={onAttachmentsChanged}
        busy={saveAction.busy}
      />
      <MoneyPanel
        workspace={{ ...workspace, profile }}
        onSave={save}
        busy={saveAction.busy}
      />
    </section>
  );
}

export function ConciergeCockpit({
  trip,
  onImport,
}: {
  trip: Trip;
  onImport: () => void;
}) {
  const gateway = useGateway();
  const conciergeVersion = useScopeKey(conciergeScope(trip.id));
  const tripVersion = useScopeKey(tripScope(trip.id));
  const documentsVersion = useScopeKey(documentsScope(trip.id));
  const workspace = useAsyncData(
    () => gateway.getConciergeWorkspace(trip.id),
    `${conciergeVersion}:${tripVersion}:${trip.updatedAt}`,
  );
  const documents = useAsyncData(
    () => gateway.listDocuments(trip.id),
    documentsVersion,
  );
  if (workspace.status === "loading" && !workspace.data) {
    return (
      <section className="voy-concierge" aria-busy="true" role="status">
        <span className="voy-sr-only">Loading the concierge cockpit</span>
        <Skeleton height="18rem" />
      </section>
    );
  }
  if (workspace.error && !workspace.data) {
    return (
      <Banner
        tone="error"
        role="alert"
        title={describeError(workspace.error).title}
        action={
          <Button variant="secondary" onClick={workspace.reload}>
            Retry
          </Button>
        }
      >
        {describeError(workspace.error).body}
      </Banner>
    );
  }
  if (!workspace.data) return null;
  return (
    <CockpitEditor
      key={`${trip.updatedAt}:${workspace.data.profile.updatedAt ?? "new"}`}
      trip={trip}
      initial={workspace.data}
      documents={documents.data ?? []}
      attachments={workspace.data.attachments}
      onImport={onImport}
      onAttachmentsChanged={workspace.reload}
    />
  );
}
