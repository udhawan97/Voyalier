import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SourceLink, VisaPrep, VisaStep } from "@voyalier/contracts";
import { MAX_VISA_NOTE_CHARS, countChars } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
import {
  tripScope,
  useRevalidate,
  useScopeKey,
  visaScope,
} from "../app/revalidate";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
import { Button } from "../components/Button";
import { TextField } from "../components/fields";
import { FileTextIcon } from "../components/icons";
import { Empty, SectionTitle, Skeleton } from "../components/primitives";

/**
 * The visa preparation cockpit.
 *
 * ADR-0006 is the whole shape of this view: Voyalier never decides whether a
 * visa is needed. The entry path is a *quote* — rendered with the authority that
 * published it and the date it was read — and every requirement is a link out.
 * The words this panel contributes are translation and caution, which is why the
 * disclaimer is not dismissible and sits above the route rather than under it.
 *
 * Curated prose arrives from the core carrying a `language` tag, and is marked
 * up with it, so a reader in another locale is not misled into thinking the
 * guidance was translated. Interface chrome around it *is* translated.
 */
export function VisaPanel({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const revalidate = useRevalidate();
  const { status, data } = useAsyncData(
    () => gateway.getVisaPrep(tripId),
    useScopeKey(visaScope(tripId)),
  );

  // Ticking a box reaches beyond this panel: the entry-requirements readiness
  // item reports the traveler's own tally, and that rides on TripDetail. Naming
  // both scopes is how this panel says so.
  const changed = () => revalidate(visaScope(tripId), tripScope(tripId));

  return (
    <section className="voy-visa" aria-labelledby="visa-title">
      <SectionTitle id="visa-title" icon={<FileTextIcon />}>
        {t("visa.title")}
      </SectionTitle>

      {/* Never conditional, never dismissible: it is the product's position, not
          a notice about a state the traveler can resolve. */}
      <p className="voy-visa__disclaimer" role="note">
        {t("visa.disclaimer")}
      </p>

      {status === "loading" && !data ? (
        <Skeleton height="8rem" />
      ) : data ? (
        <VisaCockpit prep={data} onChanged={changed} />
      ) : (
        <Empty title={t("visa.unavailable")} />
      )}
    </section>
  );
}

function VisaCockpit({
  prep,
  onChanged,
}: {
  prep: VisaPrep;
  onChanged: () => void;
}) {
  return (
    <>
      <NationalityPicker prep={prep} onChanged={onChanged} />
      {prep.nationalityIso2 ? (
        <EntryPathQuoteCard prep={prep} />
      ) : (
        <p className="voy-visa__hint">{t("visa.pickNationality")}</p>
      )}
      {prep.journey ? (
        <Journey prep={prep} onChanged={onChanged} />
      ) : prep.nationalityIso2 ? (
        <NoJourney prep={prep} />
      ) : null}
    </>
  );
}

/**
 * The passport the journey resolves against.
 *
 * A free-text ISO code rather than a country list: the contract takes alpha-2,
 * every country resolves to *some* honest answer, and a 250-entry translated
 * <select> would be a lot of catalog for a field most travelers set once.
 */
function NationalityPicker({
  prep,
  onChanged,
}: {
  prep: VisaPrep;
  onChanged: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fieldId = useId();
  const suggested = prep.suggestedNationalityIso2 ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? prep.nationalityIso2 ?? suggested;

  const save = useAsyncAction(
    (code: string) =>
      gateway.setVisaNationality({
        tripId: prep.tripId,
        nationalityIso2: code,
      }),
    () => {
      setDraft(null);
      setInvalid(false);
      announce(t("visa.nationalitySaved"));
      onChanged();
    },
  );

  /**
   * What the field says when it refuses.
   *
   * Never `describeError(...).title` for this form. That copy is the banner
   * title for a multi-field dialog — "Check the highlighted fields" — and this
   * form has one field, drew no highlight, and left the traveler looking for a
   * marker that did not exist. A single-field form can name the rule instead.
   */
  const error =
    invalid || save.error ? t("visa.nationalityInvalid") : undefined;

  return (
    <form
      className="voy-visa__nationality"
      onSubmit={(event) => {
        event.preventDefault();
        const code = value.trim();
        // An empty submit used to return here silently, so a real button did
        // nothing observable at all.
        if (code.length !== 2) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void save.run(code);
      }}
    >
      <TextField
        id={fieldId}
        label={t("visa.nationalityLabel")}
        value={value}
        maxLength={2}
        autoComplete="country"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value.toUpperCase());
          // Stop arguing the moment the field is answerable again.
          if (event.target.value.trim().length === 2) setInvalid(false);
        }}
        error={error}
        hint={
          /* Prefilled from the traveler's last trip, never applied for them:
             a trip may not be for the person who set the previous one. */
          !prep.nationalityIso2 && suggested
            ? t("visa.nationalitySuggested")
            : t("visa.nationalityHelp")
        }
      />
      <Button type="submit" busy={save.busy}>
        {t("visa.nationalitySave")}
      </Button>
    </form>
  );
}

/** The quoted entry path, always shown with its source and the date it was read. */
function EntryPathQuoteCard({ prep }: { prep: VisaPrep }) {
  const quote = prep.entryPath;
  // No quote means no authority to name — either the destination country could
  // not be worked out, or nothing is curated for the one that was. The two are
  // indistinguishable on the wire and the honest sentence is the same for both:
  // Voyalier has nobody to point at, so it points at nobody. It used to reach
  // for the only authority it had, which put Canada in front of a traveler
  // flying to Tokyo (ADR-0006, amended 2026-07-29).
  if (!quote) return <p className="voy-visa__hint">{t("visa.noAuthority")}</p>;

  return (
    <div className="voy-visa__quote">
      <p className="voy-visa__route">
        {prep.journey ? prep.journey.routeLabel : t(`visa.path.${quote.path}`)}
      </p>
      <p className="voy-visa__attribution">
        {t("visa.quotedFrom")} {quote.sourceName} · {t("visa.curatedAsOf")}{" "}
        {quote.curatedAsOf}
      </p>
      <OfficialLinks
        links={[{ label: t("visa.confirmAtSource"), url: quote.sourceUrl }]}
      />
    </div>
  );
}

/** Nothing curated, or the authority publishes conditions rather than an answer. */
function NoJourney({ prep }: { prep: VisaPrep }) {
  return (
    <Empty title={t("visa.noJourney")}>
      <p>{t("visa.noJourneyDetail")}</p>
      {prep.entryPath ? (
        <OfficialLinks
          links={[
            { label: t("visa.confirmAtSource"), url: prep.entryPath.sourceUrl },
          ]}
        />
      ) : null}
    </Empty>
  );
}

function Journey({
  prep,
  onChanged,
}: {
  prep: VisaPrep;
  onChanged: () => void;
}) {
  const journey = prep.journey;
  const [openStepId, setOpenStepId] = useState<string | null>(
    journey?.steps[0]?.id ?? null,
  );
  // False until the traveler picks a step themselves, so opening the panel
  // never yanks focus out of whatever they were reading.
  const [chosen, setChosen] = useState(false);

  const checked = useMemo(
    () =>
      new Set(
        prep.items.filter((item) => item.checked).map((i) => i.documentId),
      ),
    [prep.items],
  );
  if (!journey) return null;

  /**
   * The steps this journey can actually be finished from.
   *
   * A curated journey opens by asking whether the traveler needs the route at
   * all — links, no documents, nothing to tick. Counting it in the denominator
   * meant a traveler who ticked all sixteen documents read "7 of 8 complete"
   * forever, with no remaining action anywhere that could close the gap.
   */
  const askableSteps = journey.steps.filter(
    (step) => step.documents.length > 0,
  );
  const isComplete = (step: VisaStep) =>
    step.documents.length > 0 &&
    step.documents.every((document) => checked.has(document.id));
  const doneSteps = askableSteps.filter(isComplete).length;
  const openStep =
    journey.steps.find((step) => step.id === openStepId) ?? journey.steps[0];

  return (
    <div className="voy-visa__journey" lang={journey.language}>
      <p className="voy-visa__progress">
        {/* Attributed to the traveler in the same breath as the number. */}
        {t("visa.progress")
          .replace("{done}", String(doneSteps))
          .replace("{total}", String(askableSteps.length))}
      </p>

      <div className="voy-visa__cockpit">
        <ol className="voy-visa__rail">
          {journey.steps.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                className="voy-visa__rail-step"
                aria-current={step.id === openStep.id ? "step" : undefined}
                onClick={() => {
                  setOpenStepId(step.id);
                  setChosen(true);
                }}
              >
                <span className="voy-visa__rail-ordinal">{step.ordinal}</span>
                <span>{step.title}</span>
                {/* Never color alone. */}
                <span className="voy-visa__rail-state">
                  {isComplete(step) ? t("visa.stepDone") : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <StepDetail
          key={openStep.id}
          tripId={prep.tripId}
          step={openStep}
          prep={prep}
          takeFocus={chosen}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

function StepDetail({
  tripId,
  step,
  prep,
  takeFocus,
  onChanged,
}: {
  tripId: string;
  step: VisaStep;
  prep: VisaPrep;
  /** Whether the traveler asked for this step, rather than it being the default. */
  takeFocus: boolean;
  onChanged: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  /**
   * Land the traveler in the step they picked.
   *
   * The rail sits beside this on a wide screen, so the change is visible for
   * free; below 48rem it stacks above, and the detail was rendering entirely
   * below the fold — the tap moved nothing and said nothing. Focus rather than
   * a scroll call, because it also announces the new step to a screen reader.
   * The parent remounts this on every selection, so a mount-time effect is the
   * whole mechanism.
   */
  useEffect(() => {
    if (takeFocus) titleRef.current?.focus();
  }, [takeFocus]);

  return (
    <div className="voy-visa__step">
      <h3 className="voy-visa__step-title" ref={titleRef} tabIndex={-1}>
        {t("visa.stepLabel")
          .replace("{ordinal}", String(step.ordinal))
          .replace("{title}", step.title)}
      </h3>
      {step.authorityTerm ? (
        <p className="voy-visa__authority-term">
          {t("visa.authorityCallsIt")} “{step.authorityTerm}”
        </p>
      ) : null}
      <p className="voy-visa__plain">{step.plainExplanation}</p>

      {step.documents.map((document) => (
        <DocumentRow
          key={document.id}
          tripId={tripId}
          documentId={document.id}
          label={document.label}
          plain={document.plainExplanation}
          gotchas={document.gotchas}
          links={document.links}
          item={prep.items.find((entry) => entry.documentId === document.id)}
          onChanged={onChanged}
        />
      ))}

      <OfficialLinks links={step.links} />
    </div>
  );
}

function DocumentRow({
  tripId,
  documentId,
  label,
  plain,
  gotchas,
  links,
  item,
  onChanged,
}: {
  tripId: string;
  documentId: string;
  label: string;
  plain: string;
  gotchas: string[];
  links: SourceLink[];
  item: VisaPrep["items"][number] | undefined;
  onChanged: () => void;
}) {
  const gateway = useGateway();
  const fieldId = useId();
  const checked = item?.checked ?? false;
  const [note, setNote] = useState<string | null>(null);
  const noteValue = note ?? item?.note ?? "";
  const tooLong = countChars(noteValue) > MAX_VISA_NOTE_CHARS;

  const save = useAsyncAction(
    (nextChecked: boolean, nextNote: string) =>
      gateway.setVisaItemProgress({
        tripId,
        documentId,
        checked: nextChecked,
        note: nextNote || undefined,
      }),
    () => {
      setNote(null);
      onChanged();
    },
  );

  return (
    <div className="voy-visa__doc">
      <label className="voy-visa__doc-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => void save.run(event.target.checked, noteValue)}
        />
        <span className="voy-visa__doc-label">{label}</span>
      </label>
      <p className="voy-visa__doc-plain">{plain}</p>

      {gotchas.map((gotcha) => (
        <p key={gotcha} className="voy-visa__gotcha">
          <span className="voy-sr-only">{t("visa.watchOut")}</span>
          {gotcha}
        </p>
      ))}

      <label className="voy-visa__doc-note" htmlFor={fieldId}>
        {t("visa.noteLabel")}
      </label>
      <textarea
        id={fieldId}
        className="voy-input"
        rows={2}
        value={noteValue}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (tooLong) return;
          if (noteValue !== (item?.note ?? ""))
            void save.run(checked, noteValue);
        }}
      />
      {/* The shared field-error class, not a panel-local one: `.voy-error` was
          invented here and never given a colour, so every error in this panel
          has rendered as ordinary body text since 0.6.0. */}
      {tooLong ? (
        <p className="voy-field__error" role="alert">
          {t("visa.noteTooLong")}
        </p>
      ) : null}
      {save.error ? (
        <p className="voy-field__error" role="alert">
          {describeError(save.error).title}
        </p>
      ) : null}

      <OfficialLinks links={links} />
    </div>
  );
}

function OfficialLinks({ links }: { links: SourceLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="voy-visa__links">
      {links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer noopener">
            {link.label}
            <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
