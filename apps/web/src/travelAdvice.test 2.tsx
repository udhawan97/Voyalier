import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Official travel advice is fetched only on an explicit click, then shown
 * verbatim with source link, licence attribution, and retrieval time.
 */
describe("official travel advice", () => {
  it("fetches a dated snapshot after an explicit country choice and click", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const advice = await screen.findByRole("region", {
      name: "Official travel advice",
    });

    // Consent copy is present before any fetch, and no snapshot exists yet.
    expect(
      within(advice).getByText(/contacts www\.gov\.uk once/),
    ).toBeInTheDocument();
    expect(within(advice).queryByText(/Read the full advice/)).toBeNull();

    // The button stays disabled until a country is chosen.
    const button = within(advice).getByRole("button", {
      name: "Fetch official advice",
    });
    expect(button).toBeDisabled();

    // Options load asynchronously; a select ignores values with no option.
    await within(advice).findByRole("option", { name: "Japan" });
    fireEvent.change(
      within(advice).getByLabelText("Country to fetch official advice for"),
      { target: { value: "japan" } },
    );
    fireEvent.click(
      within(advice).getByRole("button", { name: "Fetch official advice" }),
    );

    // The snapshot renders verbatim with source, licence, and retrieval time.
    expect(
      await within(advice).findByRole("heading", { name: "Japan" }),
    ).toBeInTheDocument();
    expect(
      within(advice).getByText(/FCDO travel advice for Japan/),
    ).toBeInTheDocument();
    const source = within(advice).getByRole("link", {
      name: /Read the full advice on GOV\.UK/,
    });
    expect(source).toHaveAttribute(
      "href",
      "https://www.gov.uk/foreign-travel-advice/japan",
    );
    expect(
      within(advice).getByText(/Open Government Licence v3\.0/),
    ).toBeInTheDocument();
    expect(
      within(advice).getByText(/Written for UK passport holders/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(advice).getByRole("button", { name: "Fetch again" }),
      ).toBeInTheDocument(),
    );
  });

  it("persists the snapshot on the trip detail through the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });

    const before = await gateway.getTrip(trip.id);
    expect(before.travelAdvice).toBeUndefined();

    const snapshot = await gateway.fetchTravelAdvice({
      tripId: trip.id,
      countrySlug: "japan",
    });
    expect(snapshot.countryName).toBe("Japan");
    expect(snapshot.retrievedAt).toBeTruthy();

    const after = await gateway.getTrip(trip.id);
    expect(after.travelAdvice?.countrySlug).toBe("japan");

    await expect(
      gateway.fetchTravelAdvice({ tripId: trip.id, countrySlug: "atlantis" }),
    ).rejects.toMatchObject({ code: "validation/invalid_input" });
  });
});
