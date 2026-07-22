import type {
  AstroDay,
  CountryFacts,
  CurrencyRate,
  DestinationFactsSnapshot,
  HeritageSite,
  NearbyAirport,
  TimeDifference,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDate, formatInstant } from "../app/format";
import { t } from "../app/i18n";
import { APP_LOCALE } from "../app/locale";
import { SectionTitle } from "../components/primitives";
import { GlobeIcon } from "../components/icons";
import { useAsyncAction } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

/** Reference currencies the money block quotes the destination against. */
const REFERENCE_CURRENCIES = ["USD", "EUR", "GBP"] as const;

/** Convert one unit of `from` into `to` via the euro, or null if either is absent. */
function crossRate(
  rates: CurrencyRate[],
  from: string,
  to: string,
): number | null {
  const perEur = (code: string) =>
    rates.find((rate) => rate.code === code)?.perEur ?? null;
  const a = perEur(from);
  const b = perEur(to);
  if (a === null || b === null) return null;
  return b / a;
}

/**
 * The clock block: how far the destination runs ahead of (or behind) home, from
 * the two stored UTC offsets. Sub-hour zones keep their minutes; a zero gap is
 * shown plainly as "same time" rather than hidden.
 */
function Clock({
  destination,
  diff,
}: {
  destination: string;
  diff: TimeDifference;
}) {
  const abs = Math.abs(diff.offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const duration =
    minutes === 0
      ? t("facts.clock.hours", { hours })
      : t("facts.clock.hoursMinutes", { hours, minutes });
  const sentence =
    diff.offsetMinutes === 0
      ? t("facts.clock.same", { destination, origin: diff.originPlace })
      : t(diff.offsetMinutes > 0 ? "facts.clock.ahead" : "facts.clock.behind", {
          destination,
          duration,
          origin: diff.originPlace,
        });
  return (
    <section className="voy-facts__block" aria-labelledby="facts-clock-title">
      <h3 id="facts-clock-title" className="voy-facts__block-title">
        {t("facts.clock.title")}
      </h3>
      <p className="voy-facts__clock">{sentence}</p>
    </section>
  );
}

/**
 * The sky block: sun times, day length and the moon, computed offline. Polar
 * days and nights are stated plainly rather than shown as a rise that never
 * happens.
 */
function Sky({ days }: { days: AstroDay[] }) {
  return (
    <section className="voy-facts__block" aria-labelledby="facts-sky-title">
      <h3 id="facts-sky-title" className="voy-facts__block-title">
        {t("facts.sky.title")}
      </h3>
      <ul className="voy-facts__days">
        {days.map((day) => (
          <li key={day.date} className="voy-facts__day">
            <span className="voy-facts__day-date">{formatDate(day.date)}</span>
            <span className="voy-facts__day-sun">
              {day.polar === "polarDay"
                ? t("facts.polar.day")
                : day.polar === "polarNight"
                  ? t("facts.polar.night")
                  : t("facts.sky.sun", {
                      sunrise: day.sunrise ?? "—",
                      sunset: day.sunset ?? "—",
                    })}
            </span>
            <span className="voy-facts__day-moon">
              {t("facts.sky.moon", {
                phase: t(`moon.${day.moon.name}`),
                pct: day.moon.illuminationPct,
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The money block: the destination currency against a few reference
 * currencies, from the stored ECB rates. Labelled indicative — never a card or
 * ATM rate — and honest when the ECB does not publish the currency.
 */
function Money({
  snapshot,
  currencyCode,
}: {
  snapshot: DestinationFactsSnapshot;
  currencyCode: string;
}) {
  const rows = REFERENCE_CURRENCIES.map((from) => ({
    from,
    value: crossRate(snapshot.currencyRates, from, currencyCode),
  })).filter((row) => row.from !== currencyCode);
  const anyRate = rows.some((row) => row.value !== null);

  return (
    <section className="voy-facts__block" aria-labelledby="facts-money-title">
      <h3 id="facts-money-title" className="voy-facts__block-title">
        {t("facts.money.title")}
      </h3>
      {anyRate ? (
        <>
          <ul className="voy-facts__rates">
            {rows.map((row) =>
              row.value === null ? null : (
                <li key={row.from}>
                  {t("facts.money.rate", {
                    from: row.from,
                    to: currencyCode,
                    value: row.value.toLocaleString(APP_LOCALE, {
                      maximumFractionDigits: 2,
                    }),
                  })}
                </li>
              ),
            )}
          </ul>
          <p className="voy-facts__note">
            {t("facts.money.indicative", {
              date: formatDate(snapshot.rateDate),
            })}
          </p>
        </>
      ) : (
        <p className="voy-facts__note">
          {t("facts.money.noRate", { currency: currencyCode })}
        </p>
      )}
    </section>
  );
}

/** The practical block: plug, voltage, driving side, calling code, emergency. */
function Practical({ facts }: { facts: CountryFacts }) {
  const emergency = facts.emergency;
  return (
    <section
      className="voy-facts__block"
      aria-labelledby="facts-practical-title"
    >
      <h3 id="facts-practical-title" className="voy-facts__block-title">
        {t("facts.practical.title")}
      </h3>
      <ul className="voy-facts__practical">
        <li>
          {t("facts.practical.plug", {
            types: facts.plugTypes.join(" / "),
            voltage: facts.voltageV,
            frequency: facts.frequencyHz,
          })}
        </li>
        <li>
          {facts.drivesOnLeft
            ? t("facts.practical.driveLeft")
            : t("facts.practical.driveRight")}
        </li>
        <li>{t("facts.practical.calling", { code: facts.callingCode })}</li>
        <li>
          {emergency.general
            ? t("facts.practical.emergency", { number: emergency.general })
            : t("facts.practical.emergencyServices", {
                police: emergency.police ?? "—",
                ambulance: emergency.ambulance ?? "—",
                fire: emergency.fire ?? "—",
              })}
        </li>
      </ul>
    </section>
  );
}

/** The airports nearest the destination, closest first, with distance. */
function Airports({ airports }: { airports: NearbyAirport[] }) {
  return (
    <section
      className="voy-facts__block"
      aria-labelledby="facts-airports-title"
    >
      <h3 id="facts-airports-title" className="voy-facts__block-title">
        {t("facts.airports.title")}
      </h3>
      <ul className="voy-facts__airports">
        {airports.map((airport) => (
          <li key={airport.iata}>
            <span className="voy-facts__airport-name">
              {t("facts.airports.row", {
                iata: airport.iata,
                name: airport.name,
              })}
            </span>
            <span className="voy-facts__airport-distance">
              {t("facts.airports.distance", {
                km: Math.round(airport.distanceKm),
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A short, conservative tipping guide for the destination country. */
function Tipping({ guidance }: { guidance: string }) {
  return (
    <section className="voy-facts__block" aria-labelledby="facts-tipping-title">
      <h3 id="facts-tipping-title" className="voy-facts__block-title">
        {t("facts.tipping.title")}
      </h3>
      <p className="voy-facts__tipping">{guidance}</p>
      <p className="voy-facts__note">{t("facts.tipping.note")}</p>
    </section>
  );
}

/** UNESCO World Heritage sites near the destination, closest first. */
function Heritage({ sites }: { sites: HeritageSite[] }) {
  return (
    <section
      className="voy-facts__block"
      aria-labelledby="facts-heritage-title"
    >
      <h3 id="facts-heritage-title" className="voy-facts__block-title">
        {t("facts.heritage.title")}
      </h3>
      <ul className="voy-facts__heritage">
        {sites.map((site) => (
          <li key={site.name}>
            <span className="voy-facts__heritage-name">
              {site.year
                ? t("facts.heritage.rowYear", {
                    name: site.name,
                    // A year is an identifier, not a quantity; locale grouping
                    // would turn 1994 into 1,994 in English.
                    year: String(site.year),
                  })
                : site.name}
            </span>
            <span className="voy-facts__heritage-distance">
              {t("facts.airports.distance", {
                km: Math.round(site.distanceKm),
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The destination-facts card: the sky (computed offline), the money (indicative
 * ECB reference rates), the practical country facts, the nearest airports, and
 * the World Heritage sites nearby — all from one consent-gated fetch.
 * Convenience, never a safety claim.
 */
export function DestinationFacts({
  tripId,
  destination,
  snapshot,
  countryFacts,
  astro,
  nearestAirports,
  worldHeritage,
  tipping,
  timeDifference,
  onFetched,
}: {
  tripId: string;
  destination: string;
  snapshot: DestinationFactsSnapshot | undefined;
  countryFacts: CountryFacts | undefined;
  astro: AstroDay[];
  nearestAirports: NearbyAirport[];
  worldHeritage: HeritageSite[];
  tipping: string | undefined;
  timeDifference: TimeDifference | undefined;
  onFetched: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fetchAction = useAsyncAction(
    () => gateway.fetchDestinationFacts(tripId),
    (fetched) => {
      announce(
        t("facts.retrieved", { stamp: formatInstant(fetched.retrievedAt) }),
      );
      onFetched();
    },
  );
  const error = fetchAction.error;

  return (
    <section className="voy-facts" aria-labelledby="facts-title">
      <SectionTitle id="facts-title" icon={<GlobeIcon />}>
        {t("facts.title")}
      </SectionTitle>

      {snapshot ? (
        <div className="voy-facts__grid">
          {timeDifference ? (
            <Clock destination={snapshot.placeName} diff={timeDifference} />
          ) : null}
          {astro.length > 0 ? <Sky days={astro} /> : null}
          <Money
            snapshot={snapshot}
            currencyCode={countryFacts?.currencyCode ?? ""}
          />
          {countryFacts ? (
            <Practical facts={countryFacts} />
          ) : (
            <section className="voy-facts__block">
              <h3 className="voy-facts__block-title">
                {t("facts.practical.title")}
              </h3>
              <p className="voy-facts__note">{t("facts.practical.none")}</p>
            </section>
          )}
          {tipping ? <Tipping guidance={tipping} /> : null}
          {nearestAirports.length > 0 ? (
            <Airports airports={nearestAirports} />
          ) : null}
          {worldHeritage.length > 0 ? <Heritage sites={worldHeritage} /> : null}
        </div>
      ) : null}

      <div className="voy-facts__fetch">
        <Button
          variant="secondary"
          onClick={() => fetchAction.run()}
          busy={fetchAction.busy}
        >
          {snapshot ? t("facts.fetchAgain") : t("facts.fetch")}
        </Button>
      </div>
      <p className="voy-facts__consent">
        {t("facts.consent", { destination })}
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
