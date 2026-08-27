import type {
  DisruptionPlan,
  FallbackPointer,
  Handoff,
} from "@voyalier/contracts";

import { t, plural } from "../app/i18n";
import { Button } from "../components/Button";
import { SectionTitle } from "../components/primitives";
import { RouteIcon } from "../components/icons";

function FactAction({
  factId,
  label,
  onFocusFact,
}: {
  factId: string;
  label: string;
  onFocusFact: (id: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      className="voy-disruption__source-action"
      aria-label={t("disruption.openFact.label", { subject: label })}
      onClick={() => onFocusFact(factId)}
    >
      {t("disruption.openFact")}
    </Button>
  );
}

/**
 * What the plan costs if something slips (ADR-0016 §2).
 *
 * The voice here is the whole feature. It states exposure and stops: it never
 * proposes an alternative service, never reassures, and never implies a
 * probability. "The recorded gap is 45 minutes" is a fact this workspace can
 * stand behind; "the connection should work" is not.
 *
 * Every interval is labeled as recorded arithmetic. The core still carries a
 * band for deterministic ordering and parity, but the UI does not turn a
 * product-authored threshold into reassurance or connection advice.
 */
export function DisruptionPanel({
  plan,
  onFocusFact,
}: {
  plan: DisruptionPlan;
  onFocusFact: (id: string) => void;
}) {
  const hasSomething =
    plan.handoffs.length > 0 ||
    plan.exposedLegs.length > 0 ||
    plan.pointers.length > 0;
  if (!hasSomething) return null;

  return (
    <section
      className="voy-panel voy-disruption"
      aria-labelledby="disruption-title"
    >
      <SectionTitle id="disruption-title" icon={<RouteIcon />}>
        {t("disruption.title")}
      </SectionTitle>
      <p className="voy-panel__lede">{t("disruption.lede")}</p>

      {plan.handoffs.length > 0 ? (
        <>
          <h3 className="voy-disruption__subtitle">
            {t("disruption.handoffs.title")}
          </h3>
          <ul className="voy-disruption__list">
            {plan.handoffs.map((handoff) => {
              const from = subjectOf(handoff.from);
              const to = subjectOf(handoff.to);
              return (
                <li
                  key={`${handoff.fromFactId}-${handoff.toFactId}-${handoff.kind}`}
                  className="voy-disruption__handoff"
                >
                  <span className="voy-disruption__handoff-copy">
                    <span className="voy-disruption__slack">
                      {slackText(handoff)}
                    </span>
                    <span className="voy-disruption__between">
                      {t(`disruption.handoff.${handoff.kind}`, { from, to })}
                    </span>
                  </span>
                  <span className="voy-disruption__actions">
                    <FactAction
                      factId={handoff.fromFactId}
                      label={from}
                      onFocusFact={onFocusFact}
                    />
                    <FactAction
                      factId={handoff.toFactId}
                      label={to}
                      onFocusFact={onFocusFact}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {plan.exposedLegs.length > 0 ? (
        <>
          <h3 className="voy-disruption__subtitle">
            {t("disruption.exposed.title")}
          </h3>
          <ul className="voy-disruption__list">
            {plan.exposedLegs.map((leg) => (
              <li key={leg.factId} className="voy-disruption__exposed">
                <span>
                  {plural("disruption.exposed.line", leg.dependents, {
                    subject: subjectOf(leg.label),
                    minutes: String(leg.absorbsMinutes),
                  })}
                </span>
                <FactAction
                  factId={leg.factId}
                  label={subjectOf(leg.label)}
                  onFocusFact={onFocusFact}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {plan.pointers.length > 0 ? (
        <>
          <h3 className="voy-disruption__subtitle">
            {t("disruption.pointers.title")}
          </h3>
          <p className="voy-panel__note">{t("disruption.pointers.note")}</p>
          <ul className="voy-disruption__list">
            {plan.pointers.map((pointer) => (
              <li key={pointerKey(pointer)} className="voy-disruption__pointer">
                <span>{pointerText(pointer)}</span>
                {pointer.code === "carrier_on_confirmation" ? (
                  <FactAction
                    factId={pointer.factId}
                    label={pointer.carrier}
                    onFocusFact={onFocusFact}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * The recorded interval, in the traveler's own units.
 *
 * A negative gap is not "minus ninety minutes of slack" — it is a commitment
 * that starts before the thing it follows, and saying so plainly is the only
 * useful reading.
 */
function slackText(handoff: Handoff): string {
  if (handoff.slackMinutes < 0) {
    return t("disruption.slack.overlap", {
      minutes: String(Math.abs(handoff.slackMinutes)),
    });
  }
  const hours = Math.floor(handoff.slackMinutes / 60);
  const minutes = handoff.slackMinutes % 60;
  let duration: string;
  if (hours === 0) {
    duration = t("disruption.slack.minutes", { minutes: String(minutes) });
  } else if (minutes === 0) {
    duration = t("disruption.slack.hours", { hours: String(hours) });
  } else {
    duration = t("disruption.slack.hoursMinutes", {
      hours: String(hours),
      minutes: String(minutes),
    });
  }
  return t("disruption.slack.gap", { duration });
}

/**
 * Name a leg using only the traveler's own words. The core chose *which*
 * identifying detail exists; the noun is this catalog's.
 */
function subjectOf(label: Handoff["from"]): string {
  switch (label.code) {
    case "flight_number":
      return t("schedule.label.flight_number", { number: label.number });
    case "flight_route":
      return t("schedule.label.flight_route", {
        from: label.from,
        to: label.to,
      });
    case "flight":
      return t("schedule.label.flight");
    case "lodging_property":
      return t("schedule.label.lodging_property", { property: label.property });
    case "lodging":
      return t("schedule.label.lodging");
    case "journey_service":
      return t(`schedule.label.${label.mode}_service`, {
        service: label.service,
      });
    case "journey_route":
      return t(`schedule.label.${label.mode}_route`, {
        from: label.from,
        to: label.to,
      });
    case "journey":
      return t(`schedule.label.${label.mode}`);
    case "rental_company":
      return t("schedule.label.rental_company", { company: label.company });
    case "rental":
      return t("schedule.label.rental");
  }
}

function pointerKey(pointer: FallbackPointer): string {
  switch (pointer.code) {
    case "carrier_on_confirmation":
      return `carrier-${pointer.factId}`;
    case "alternate_airport":
      return `airport-${pointer.iata}`;
    case "diplomatic_mission":
      return `mission-${pointer.sendingCountry}-${pointer.city}-${pointer.kind}`;
  }
}

/**
 * Every pointer is a sentence about something the traveler already holds. None
 * carries a link, because this product does not curate carrier contact
 * channels (ADR-0016 §3).
 */
function pointerText(pointer: FallbackPointer): string {
  switch (pointer.code) {
    case "carrier_on_confirmation":
      return t("disruption.pointer.carrier", { carrier: pointer.carrier });
    case "alternate_airport":
      return t("disruption.pointer.airport", {
        name: pointer.name,
        iata: pointer.iata,
        km: String(pointer.distanceKm),
      });
    case "diplomatic_mission":
      return t("disruption.pointer.mission", { city: pointer.city });
  }
}
