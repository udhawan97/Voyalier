import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Public holidays are fetched on an explicit click and narrowed to the travel
 * window: only holidays that fall during the trip are shown. Informational —
 * they never clear a readiness item.
 */
describe("public holidays", () => {
  async function openHolidays() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    return screen.findByRole("region", { name: "Public holidays" });
  }

  it("fetches and lists the holidays that fall during the trip", async () => {
    const panel = await openHolidays();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Fetch public holidays" }),
    );
    // The mock puts Culture Day on the first trip day, so it lands in-window,
    // shown with its Japanese name.
    const holiday = await within(panel).findByText(/Culture Day/);
    expect(holiday).toHaveTextContent(/文化の日/);
  });

  it("filters holidays to the trip window on the detail", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-05-03",
      endDate: "2027-05-05",
    });
    await gateway.fetchPublicHolidays(trip.id);
    const detail = await gateway.getTrip(trip.id);
    // Only the in-window holiday (on 2027-05-03) survives; the year-later one is
    // filtered out.
    expect(detail.publicHolidays?.holidays).toHaveLength(1);
    expect(detail.publicHolidays?.holidays[0]?.date).toBe("2027-05-03");

    // Moving the dates off it invalidates the snapshot.
    await gateway.updateTrip(trip.id, {
      startDate: "2027-06-01",
      endDate: "2027-06-03",
    });
    const edited = await gateway.getTrip(trip.id);
    expect(edited.publicHolidays).toBeUndefined();
  });
});
