import type { PublicHolidaysSnapshot } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDate, formatDateTimeLocal, formatInstant } from "../app/format";
import { t } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { CalendarIcon } from "../components/icons";
import { useAsyncAction } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

/**
 * The public-holidays panel: the destination country's public holidays that
 * fall during the trip, fetched on an explicit click from Nager.Date and
 * narrowed to the travel window. Informational — it never clears a readiness
 * item; it just warns that banks and shops may be closed.
 */
export function PublicHolidays({
  tripId,
  destination,
  snapshot,
  onFetched,
}: {
  tripId: string;
  destination: string;
  snapshot: PublicHolidaysSnapshot | undefined;
  onFetched: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fetchAction = useAsyncAction(
    () => gateway.fetchPublicHolidays(tripId),
    (fetched) => {
      announce(
        t("holidays.retrieved", { stamp: formatInstant(fetched.retrievedAt) }),
      );
      onFetched();
    },
  );
  const error = fetchAction.error;

  return (
    <section className="voy-holidays" aria-labelledby="holidays-title">
      <SectionTitle id="holidays-title" icon={<CalendarIcon />}>
        {t("holidays.title")}
      </SectionTitle>

      {snapshot ? (
        snapshot.holidays.length > 0 ? (
          <ul className="voy-holidays__list">
            {snapshot.holidays.map((holiday) => (
              <li
                key={`${holiday.date}-${holiday.name}`}
                className="voy-holidays__item"
              >
                <span className="voy-holidays__date">
                  {formatDate(holiday.date)}
                </span>
                <span className="voy-holidays__name">
                  {holiday.localName && holiday.localName !== holiday.name
                    ? t("holidays.nameLocal", {
                        name: holiday.name,
                        localName: holiday.localName,
                      })
                    : holiday.name}
                  {holiday.global ? "" : ` ${t("holidays.regional")}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="voy-holidays__empty">
            {t("holidays.none", { country: snapshot.countryName })}
          </p>
        )
      ) : null}

      <div className="voy-holidays__fetch">
        <Button
          variant="secondary"
          onClick={() => fetchAction.run()}
          busy={fetchAction.busy}
        >
          {snapshot ? t("holidays.fetchAgain") : t("holidays.fetch")}
        </Button>
      </div>
      <p className="voy-holidays__consent">
        {t("holidays.consent", { destination })}
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
