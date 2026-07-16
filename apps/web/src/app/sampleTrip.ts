import type { AppGateway, Trip } from "@voyalier/contracts";
// The one copy of the sample confirmation, shared with the Rust core's test so
// the two can never drift. It is deliberately JSON-LD, because that is what a
// real airline or hotel email carries and it is the path the structured parser
// takes — a first-run demo exercising a different code path than real mail
// would be a lie about the product. Every name in it is invented, and
// "Fictional" is left in the text so a screenshot can never be mistaken for a
// real booking.
import SAMPLE_CONFIRMATION from "@voyalier/contracts/fixtures/sample-confirmation.html?raw";

import { t } from "./i18n";

/**
 * Build the sample trip through the ordinary public flow — `createTrip` then
 * `importDocument` — and leave its candidates pending.
 *
 * That is the whole point: the newcomer lands on a trip that is mid-review, so
 * the first thing they do is the thing Voyalier is actually about (confirm or
 * dismiss what a parser proposed), on data that costs nothing to get wrong. It
 * uses no privileged path and no seeding, so the sample cannot drift from the
 * real flow — if import breaks, the sample breaks, loudly.
 *
 * The result is an ordinary trip: it archives and deletes like any other.
 */
export async function createSampleTrip(gateway: AppGateway): Promise<Trip> {
  const trip = await gateway.createTrip({
    title: t("sample.title"),
    origin: t("sample.origin"),
    destination: t("sample.destination"),
    startDate: "2027-04-02",
    endDate: "2027-04-06",
  });
  await gateway.importDocument({
    tripId: trip.id,
    kind: "html",
    label: t("sample.document"),
    content: SAMPLE_CONFIRMATION,
  });
  return trip;
}
