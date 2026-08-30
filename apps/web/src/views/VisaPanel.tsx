import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AppError,
  Mission,
  SourceLink,
  VisaJourney,
  VisaPlaybook,
  VisaPrep,
  VisaStatsPanel,
  VisaStep,
} from "@voyalier/contracts";
import { MAX_VISA_NOTE_CHARS, countChars } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { ISO2_COUNTRY_CODES, countryName } from "../app/countries";
import { describeError, formatInstant, formatInstantDate } from "../app/format";
import { plural, t } from "../app/i18n";
import { APP_LOCALE } from "../app/locale";
import {
  tripScope,
  useRevalidate,
  useScopeKey,
  visaScope,
} from "../app/revalidate";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
import { Button } from "../components/Button";
import { Combobox } from "../components/Combobox";
import { FileTextIcon } from "../components/icons";
import { Empty, SectionTitle, Skeleton } from "../components/primitives";

/** Mirrors TravelAdvice: quoted figures older than this carry an age warning. */
const STALE_AFTER_DAYS = 7;

function daysSince(iso: string): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

/**
 * The visa preparation cockpit — four zones, top to bottom: the route header
 * (passport picker + quoted verdict), the guide (a curated journey, else the
 * universal playbook), the route statistics (ADR-0014: fetched from the
 * authority on the traveler's click, never bundled), and the missions pointer.
 *
 * ADR-0006 is the whole shape of this view: Voyalier never decides whether a
 * visa is needed. The entry path is a *quote* — rendered with the authority that
 * published it and the date it was read — and every requirement is a link out.
 * The words this panel contributes are translation and caution, which is why the
 * disclaimer is not dismissible and sits above the route rather than under it.
 *
 * Curated and playbook prose arrives from the core carrying a `language` tag,
 * and is marked up with it, so a reader in another locale is not misled into
 * thinking the guidance was translated. Interface chrome around it *is*
 * translated.
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
      <SectionTitle id="visa-title" icon={<FileTextIcon />} tabIndex={-1}>
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
      <Guide prep={prep} onChanged={onChanged} />
      {prep.nationalityIso2 && prep.stats ? (
        <StatsCard tripId={prep.tripId} prep={prep} onChanged={onChanged} />
      ) : null}
      {prep.missions.length > 0 ? <Missions missions={prep.missions} /> : null}
    </>
  );
}

/**
 * Where the traveler's own country keeps a mission in the destination country.
 *
 * A pointer, and the copy says so in as many words. The bundled extract is
 * Wikidata, which records closure unevenly enough that it once returned
 * embassies of states dissolved in 1990, so every entry is shown as something
 * to confirm rather than somewhere to go — and the confirm link is the
 * traveler's own foreign ministry, not this app. Coordinates are carried in the
 * contract but deliberately not rendered as a map pin here for the same reason.
 *
 * Collapsed behind a disclosure by default: it is reference material, not a
 * step, and it was crowding the guide it sits under.
 */
function Missions({ missions }: { missions: Mission[] }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <section className="voy-visa__missions" aria-labelledby={`${regionId}-t`}>
      <h3 className="voy-visa__missions-title">
        <button
          type="button"
          id={`${regionId}-t`}
          className="voy-visa__missions-toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="voy-visa__missions-marker" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          {t("visa.missions.title")}
        </button>
      </h3>
      {open ? (
        <div id={regionId}>
          <ul className="voy-visa__missions-list">
            {missions.map((mission) => (
              <li key={`${mission.kind}-${mission.city}-${mission.latitude}`}>
                {mission.city
                  ? t("visa.missions.entryWithCity", {
                      kind: t(`visa.missions.kind.${mission.kind}`),
                      city: mission.city,
                    })
                  : t("visa.missions.entry", {
                      kind: t(`visa.missions.kind.${mission.kind}`),
                    })}
              </li>
            ))}
          </ul>
          <p className="voy-visa__missions-note">
            {t("visa.missions.confirm")}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The passport the route resolves against.
 *
 * A combobox over the alpha-2 list with names in the traveler's locale —
 * suggestions never gate what can be typed, so a bare two-letter code still
 * works, and the committed value is always the code the contract takes.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const suggested = prep.suggestedNationalityIso2 ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const value = draft ?? prep.nationalityIso2 ?? "";

  const save = useAsyncAction(
    (code: string) =>
      gateway.setVisaNationality({
        tripId: prep.tripId,
        nationalityIso2: code,
      }),
    () => {
      setDraft(null);
      setInvalid(false);
      setSubmittedCode(null);
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
  const serverValidation =
    save.error?.code === "validation/invalid_input" ||
    save.error?.code === "validation/invalid_date_range";
  const error =
    invalid || (serverValidation && submittedCode === value)
      ? t("visa.nationalityInvalid")
      : undefined;
  const actionError: AppError | undefined =
    save.error &&
    submittedCode !== null &&
    (submittedCode === value || (!value && submittedCode === suggested)) &&
    !serverValidation &&
    save.error.code !== "transport/failure"
      ? save.error
      : undefined;

  /**
   * Local data only: names + codes, case- and diacritic-insensitively.
   *
   * Ranked the way a traveler types: a code match first ("in" → India),
   * then names the query begins ("Ind" → India before the Indian Ocean
   * Territory), then names that merely contain it — each band in the
   * locale's own alphabetical order, not ISO code order.
   */
  const suggestions = (query: string) => {
    const fold = (text: string) =>
      text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const needle = fold(query.trim());
    const band = (code: string, name: string): number => {
      if (!needle) return 3;
      if (code.toLowerCase().startsWith(needle)) return 0;
      if (name.startsWith(needle)) return 1;
      if (name.includes(needle)) return 2;
      return -1;
    };
    const matches = ISO2_COUNTRY_CODES.map((code) => {
      const name = countryName(code, APP_LOCALE);
      return { code, name, band: band(code, fold(name)) };
    })
      .filter((entry) => entry.band >= 0)
      .sort(
        (a, b) => a.band - b.band || a.name.localeCompare(b.name, APP_LOCALE),
      );
    return Promise.resolve(
      matches.slice(0, 12).map(({ code, name }) => ({
        value: code,
        label: `${name} — ${code}`,
      })),
    );
  };

  return (
    <form
      className="voy-visa__nationality"
      onSubmit={(event) => {
        event.preventDefault();
        // Uppercase at submit only, so typing a name to search never fights
        // the field.
        const code = value.trim().toUpperCase();
        // An empty submit used to return here silently, so a real button did
        // nothing observable at all.
        if (!/^[A-Z]{2}$/.test(code)) {
          setSubmittedCode(null);
          setInvalid(true);
          inputRef.current?.focus();
          return;
        }
        setInvalid(false);
        setSubmittedCode(value);
        void save.run(code);
      }}
    >
      <Combobox
        id={fieldId}
        inputRef={inputRef}
        label={t("visa.nationalityLabel")}
        value={value}
        onChange={(next) => {
          setDraft(next);
          setSubmittedCode(null);
          if (/^[A-Za-z]{2}$/.test(next.trim())) setInvalid(false);
        }}
        fetchSuggestions={suggestions}
        error={error}
        hint={t("visa.nationalityHelp")}
        autoComplete="off"
        spellCheck={false}
      />
      <Button
        type="submit"
        busy={save.busy}
        // In the narrow in-flow layout, blurring the combobox removes its list
        // before pointer-up and moves this target. Preserve the field's focus
        // through the click; submit still runs and owns the final focus state.
        onMouseDown={(event) => event.preventDefault()}
      >
        {t("visa.nationalitySave")}
      </Button>
      {/* Offered, never applied: the last trip's passport as one tap — a trip
          may not be for the person who set the previous one. */}
      {!prep.nationalityIso2 && suggested && !save.busy ? (
        <button
          type="button"
          className="voy-visa__chip"
          aria-label={t("visa.nationalityChipLabel", {
            name: countryName(suggested, APP_LOCALE),
            code: suggested,
          })}
          onClick={() => {
            setInvalid(false);
            setSubmittedCode(suggested);
            void save.run(suggested);
          }}
        >
          {countryName(suggested, APP_LOCALE)} — {suggested}
        </button>
      ) : null}
      {actionError ? (
        <p className="voy-field__error" role="alert">
          {describeError(actionError).body}
        </p>
      ) : null}
    </form>
  );
}

/** The quoted entry path, always shown with its source and the date it was read. */
function EntryPathQuoteCard({ prep }: { prep: VisaPrep }) {
  const quote = prep.entryPath;
  if (!quote) {
    // No quote means no authority to name. The playbook's presence is what
    // distinguishes the two honest reasons: with it, the destination resolved
    // and nothing is curated there; without it, the destination itself could
    // not be worked out, and editing the trip is the fix.
    return (
      <p className="voy-visa__hint">
        {prep.playbook ? t("visa.noAuthority") : t("visa.noDestination")}
      </p>
    );
  }

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

/**
 * The guide zone: the curated journey when one exists, else the universal
 * playbook — one renderer for both, because both are steps the traveler works
 * through and ticks. The provenance banner is what keeps them honest: curated
 * steps were read from a named authority on a date; playbook steps were
 * written by Voyalier and say so in those words.
 */
function Guide({ prep, onChanged }: { prep: VisaPrep; onChanged: () => void }) {
  const guide: VisaJourney | VisaPlaybook | undefined =
    prep.journey ?? prep.playbook;
  const [openStepId, setOpenStepId] = useState<string | null>(
    guide?.steps[0]?.id ?? null,
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
  if (!guide || !prep.nationalityIso2) return null;

  /**
   * The steps this guide can actually be finished from.
   *
   * A guide opens by orienting — links, no documents, nothing to tick.
   * Counting those steps in the denominator meant a traveler who ticked
   * everything read "7 of 8 complete" forever, with no remaining action
   * anywhere that could close the gap.
   */
  const askableSteps = guide.steps.filter((step) => step.documents.length > 0);
  const isComplete = (step: VisaStep) =>
    step.documents.length > 0 &&
    step.documents.every((document) => checked.has(document.id));
  const doneSteps = askableSteps.filter(isComplete).length;
  const openStep =
    guide.steps.find((step) => step.id === openStepId) ?? guide.steps[0];

  const provenance = prep.journey ? (
    <p className="voy-visa__provenance voy-visa__provenance--curated">
      {t("visa.guide.provenance.curated", {
        authority: prep.journey.entryPath.sourceName,
        date: prep.journey.curatedAsOf,
      })}
    </p>
  ) : (
    <p className="voy-visa__provenance voy-visa__provenance--playbook">
      {t("visa.guide.provenance.playbook")}
    </p>
  );

  return (
    <div className="voy-visa__journey" lang={guide.language}>
      {provenance}
      <p className="voy-visa__progress">
        {/* Attributed to the traveler in the same breath as the number. */}
        {plural("visa.progress", guide.steps.length, {
          done: doneSteps,
          total: askableSteps.length,
        })}
      </p>

      <div className="voy-visa__cockpit">
        <ol className="voy-visa__rail">
          {guide.steps.map((step) => (
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

/**
 * The route statistics zone (ADR-0014).
 *
 * The authority's name is the heading in every state, so a cropped screenshot
 * still names whose numbers these are. Figures appear only after this device
 * read them from the authority's own publication, verbatim, with the retrieval
 * stamp, the source's own as-of date where it publishes one, and the licence.
 * The fetch button is the consent act; failure is loud and the kept copy
 * survives it.
 */
function StatsCard({
  tripId,
  prep,
  onChanged,
}: {
  tripId: string;
  prep: VisaPrep;
  onChanged: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const stats = prep.stats as VisaStatsPanel;
  const { source, snapshot } = stats;

  const refresh = useAsyncAction(
    () => gateway.refreshVisaStats(tripId),
    () => {
      announce(t("visa.stats.fetched"));
      onChanged();
    },
  );
  useEffect(() => {
    if (!refresh.error) return;
    announce(
      snapshot
        ? t("visa.stats.kept", {
            authority: source.authorityName,
            date: formatInstantDate(snapshot.retrievedAt),
          })
        : t("visa.stats.failedNoCopy", { authority: source.authorityName }),
    );
  }, [refresh.error, snapshot, source.authorityName, announce]);

  const staleDays = snapshot ? daysSince(snapshot.retrievedAt) : null;
  const isStale = staleDays !== null && staleDays > STALE_AFTER_DAYS;
  const highlighted = snapshot?.metrics.find(
    (metric) => metric.audience === prep.nationalityIso2,
  );

  return (
    <section className="voy-visa__stats" aria-labelledby="visa-stats-title">
      <h3 id="visa-stats-title" className="voy-visa__stats-title">
        {source.authorityName}
      </h3>

      {snapshot ? (
        <>
          {refresh.error ? (
            <p className="voy-visa__stats-kept">
              {t("visa.stats.kept", {
                authority: source.authorityName,
                date: formatInstantDate(snapshot.retrievedAt),
              })}
            </p>
          ) : null}
          {isStale ? (
            <p className="voy-visa__stats-stale">
              {t("visa.stats.stale", { days: staleDays as number })}
            </p>
          ) : null}
          {snapshot.metrics.length === 0 ? (
            /* Absence reported as absence: the source parsed, and it simply
               publishes no row for this passport code. An empty table would
               read as a broken fetch. */
            <p className="voy-visa__stats-consent">
              {t("visa.stats.noRows", {
                authority: snapshot.authorityName,
                code: prep.nationalityIso2 as string,
              })}
            </p>
          ) : (
            <div className="voy-visa__stats-scroll">
              <table className="voy-visa__stats-table">
                <caption className="voy-sr-only">
                  {t("visa.stats.caption", { authority: source.authorityName })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("visa.stats.colLabel")}</th>
                    <th scope="col">{t("visa.stats.colValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.metrics.map((metric) => {
                    const mine = metric.audience === prep.nationalityIso2;
                    return (
                      <tr
                        key={metric.id}
                        className={
                          mine ? "voy-visa__stats-row--mine" : undefined
                        }
                      >
                        <th scope="row">
                          {metric.label}
                          {metric.audience ? (
                            <span className="voy-visa__stats-audience">
                              {" "}
                              · {metric.audience}
                            </span>
                          ) : null}
                          {mine ? (
                            <span className="voy-visa__stats-mine">
                              {t("visa.stats.yourPassport")}
                            </span>
                          ) : null}
                        </th>
                        {/* Verbatim, units and all — never converted. */}
                        <td>{metric.value}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {highlighted ? (
            <p className="voy-visa__stats-highlight-note">
              {t("visa.stats.highlightCaption", {
                label: highlighted.audience as string,
              })}
            </p>
          ) : null}
          <p className="voy-visa__stats-sourceline">
            {t("visa.stats.retrieved", {
              authority: snapshot.authorityName,
              stamp: formatInstant(snapshot.retrievedAt),
            })}
          </p>
          {/* The source's own date is never omitted when present: a fresh
              retrieval stamp over old figures is the stale-table trap. */}
          {snapshot.publishedAt ? (
            <p className="voy-visa__stats-sourceline">
              {t("visa.stats.publishedAs", {
                authority: snapshot.authorityName,
                stamp: formatInstant(snapshot.publishedAt),
              })}
            </p>
          ) : null}
          <p className="voy-visa__stats-licence">{snapshot.attribution}</p>
        </>
      ) : source.fetchable ? (
        <>
          <p className="voy-visa__stats-consent">
            {t("visa.stats.consent", { authority: source.authorityName })}
          </p>
          {refresh.error ? (
            <p className="voy-field__error" role="alert">
              {t("visa.stats.failedNoCopy", {
                authority: source.authorityName,
              })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="voy-visa__stats-consent">
          {t("visa.stats.unfetchable", { authority: source.authorityName })}
        </p>
      )}

      <div className="voy-visa__stats-actions">
        {source.fetchable ? (
          <Button
            onClick={() => void refresh.run()}
            busy={refresh.busy}
            variant="secondary"
          >
            {t("visa.stats.fetch")}
          </Button>
        ) : null}
        <OfficialLinks
          links={[{ label: t("visa.stats.pageLink"), url: source.pageUrl }]}
        />
      </div>
    </section>
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

  /**
   * The step's own links, minus whatever its documents already offered.
   *
   * A curated step and a document inside it legitimately cite the same
   * authority page — `ca.trv.07-submit` even builds both lists from one
   * `biometrics_links()` helper. Rendering both lists verbatim printed the
   * identical label and href one line apart, in 14 places across all four
   * curated journeys, and a repeated link reads as a second requirement.
   *
   * Filtered here rather than in core: the data is right, and only this
   * rendering repeats it. Core has no way to know the two lists land next to
   * each other on screen.
   */
  const documentLinks = new Set(
    step.documents.flatMap((document) =>
      document.links.map((link) => `${link.label} ${link.url}`),
    ),
  );
  const stepLinks = step.links.filter(
    (link) => !documentLinks.has(`${link.label} ${link.url}`),
  );

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

      <OfficialLinks links={stepLinks} />
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
