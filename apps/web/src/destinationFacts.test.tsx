import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The destination-facts card is fetched on an explicit click, then shows three
 * blocks derived from one snapshot: the sky (sun and moon, computed offline),
 * the money (indicative reference rates, dated), and the practical country
 * facts. None of it is a safety claim.
 */
describe("destination facts", () => {
  async function fetchFacts() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const facts = await screen.findByRole("region", {
      name: "Destination facts",
    });
    fireEvent.click(
      within(facts).getByRole("button", { name: "Fetch destination facts" }),
    );
    await within(facts).findByRole("heading", { name: "Sky" });
    return facts;
  }

  it("shows sun times and the moon phase, computed offline", async () => {
    const facts = await fetchFacts();
    // The first trip day's sunrise (inside "05:20 – 18:10") and its moon phase.
    expect(within(facts).getByText(/05:20/)).toBeInTheDocument();
    // Each day carries its moon; several are full in the fixture.
    expect(within(facts).getAllByText(/Full moon/i).length).toBeGreaterThan(0);
  });

  it("shows indicative currency rates, dated and labelled", async () => {
    const facts = await fetchFacts();
    expect(
      within(facts).getByRole("heading", { name: "Money" }),
    ).toBeInTheDocument();
    // The destination currency against reference currencies, via the ECB.
    expect(within(facts).getByText(/1 USD = .* JPY/)).toBeInTheDocument();
    // Never presented as a card/ATM rate.
    expect(within(facts).getByText(/indicative/i)).toBeInTheDocument();
    expect(within(facts).getByText(/Jul 17, 2026/)).toBeInTheDocument();
  });

  it("shows the nearest airports with their distance", async () => {
    const facts = await fetchFacts();
    expect(
      within(facts).getByRole("heading", { name: "Nearest airports" }),
    ).toBeInTheDocument();
    // The closest airport, its code, and a distance in km.
    expect(within(facts).getByText(/ITM/)).toBeInTheDocument();
    expect(within(facts).getByText(/39.*km/)).toBeInTheDocument();
  });

  it("shows the time difference from the trip's origin", async () => {
    const facts = await fetchFacts();
    expect(
      within(facts).getByRole("heading", { name: "Time difference" }),
    ).toBeInTheDocument();
    // Kyoto (+540) is 14h ahead of Chicago (−300) on the trip's dates.
    const clock = within(facts).getByText(/Kyoto is .* ahead of Chicago/);
    expect(clock).toHaveTextContent(/14h/);
  });

  it("shows the practical country facts", async () => {
    const facts = await fetchFacts();
    expect(
      within(facts).getByRole("heading", { name: "Practical" }),
    ).toBeInTheDocument();
    // Japan: 100 V, drives on the left, +81, police 110.
    expect(within(facts).getByText(/100\s*V/)).toBeInTheDocument();
    expect(within(facts).getByText(/left/i)).toBeInTheDocument();
    expect(within(facts).getByText(/\+81/)).toBeInTheDocument();
    expect(within(facts).getByText(/110/)).toBeInTheDocument();
  });

  it("persists the snapshot and derives facts on the trip detail", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    const before = await gateway.getTrip(trip.id);
    expect(before.destinationFacts).toBeUndefined();
    expect(before.astro).toEqual([]);

    await gateway.fetchDestinationFacts(trip.id);
    const after = await gateway.getTrip(trip.id);
    expect(after.destinationFacts?.countryCode).toBe("JP");
    expect(after.countryFacts?.currencyCode).toBe("JPY");
    expect(after.astro.length).toBeGreaterThan(0);
    expect(after.astro[0].moon.name).toBe("full_moon");
    // Kyoto (+540) seen from Chicago (−300) is 840 minutes ahead.
    expect(after.timeDifference?.originPlace).toBe("Chicago");
    expect(after.timeDifference?.offsetMinutes).toBe(840);

    // A destination edit invalidates the facts, like weather and advice.
    await gateway.updateTrip(trip.id, { destination: "Oslo" });
    const edited = await gateway.getTrip(trip.id);
    expect(edited.destinationFacts).toBeUndefined();
    expect(edited.astro).toEqual([]);
    expect(edited.timeDifference).toBeUndefined();
  });
});
