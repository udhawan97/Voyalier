import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Official travel advice is fetched only on an explicit click, then shown
 * verbatim: one card per government, each with its own wording, level scale,
 * language, and attribution. Voyalier never merges or compares them.
 */
describe("official travel advice", () => {
  it("fetches a dated panel after an explicit country choice and click", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const advice = await screen.findByRole("region", {
      name: "Official travel advice",
    });

    // Consent copy is present before any fetch, and no panel exists yet.
    expect(
      within(advice).getByText(/contacts the UK, US, Canadian, and German/),
    ).toBeInTheDocument();
    expect(within(advice).queryByText(/Read the full advice/)).toBeNull();

    // The button stays disabled until a country is chosen.
    expect(
      within(advice).getByRole("button", { name: "Fetch official advice" }),
    ).toBeDisabled();

    // Options load asynchronously; a select ignores values with no option.
    await within(advice).findByRole("option", { name: "Japan" });
    fireEvent.change(
      within(advice).getByLabelText("Country to fetch official advice for"),
      { target: { value: "japan" } },
    );
    fireEvent.click(
      within(advice).getByRole("button", { name: "Fetch official advice" }),
    );

    // Every government gets its own card, in contract order.
    for (const sourceName of [
      "UK Foreign, Commonwealth & Development Office",
      "U.S. Department of State",
      "Government of Canada — Global Affairs Canada",
      "Auswärtiges Amt (Germany)",
    ]) {
      expect(
        await within(advice).findByRole("heading", { name: sourceName }),
      ).toBeInTheDocument();
    }

    // Each keeps its own level wording; the panel never invents a shared scale.
    expect(
      within(advice).getByText("Level 1: Exercise Normal Precautions"),
    ).toBeInTheDocument();
    expect(
      within(advice).getByText("Exercise normal security precautions"),
    ).toBeInTheDocument();
    expect(
      within(advice).getByText(/Compare the sources, not the numbers/),
    ).toBeInTheDocument();

    // Every card links to its own government, never to a single merged page.
    const sourceLinks = within(advice).getAllByRole("link", {
      name: /Read the full advice at the source/,
    });
    expect(sourceLinks.map((link) => link.getAttribute("href"))).toEqual([
      "https://www.gov.uk/foreign-travel-advice/japan",
      "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
      "https://travel.gc.ca/destinations/japan",
      "https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise",
    ]);
    expect(
      within(advice).getByText(/Open Government Licence v3\.0/),
    ).toBeInTheDocument();
    expect(
      within(advice).getByText(/Public domain \(U\.S\. Department of State\)/),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        within(advice).getByRole("button", { name: "Fetch again" }),
      ).toBeInTheDocument(),
    );
  });

  it("marks the German card as German so it is not read as English", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const advice = await screen.findByRole("region", {
      name: "Official travel advice",
    });
    await within(advice).findByRole("option", { name: "Japan" });
    fireEvent.change(
      within(advice).getByLabelText("Country to fetch official advice for"),
      { target: { value: "japan" } },
    );
    fireEvent.click(
      within(advice).getByRole("button", { name: "Fetch official advice" }),
    );

    const german = await within(advice).findByText(
      "Japan: Reise- und Sicherheitshinweise",
    );
    // The source publishes in German and Voyalier does not translate it, so the
    // markup has to say so or a screen reader will read German as English.
    expect(german.closest("[lang='de']")).not.toBeNull();
  });

  it("lists CDC health notices as informational, beside the advisories", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const advice = await screen.findByRole("region", {
      name: "Official travel advice",
    });
    await within(advice).findByRole("option", { name: "Japan" });
    fireEvent.change(
      within(advice).getByLabelText("Country to fetch official advice for"),
      { target: { value: "japan" } },
    );
    fireEvent.click(
      within(advice).getByRole("button", { name: "Fetch official advice" }),
    );

    expect(
      await within(advice).findByRole("heading", {
        name: "Health notices (US CDC)",
      }),
    ).toBeInTheDocument();
    const notice = within(advice).getByRole("link", {
      name: /Level 1 - Measles in Japan/,
    });
    expect(notice).toHaveAttribute(
      "href",
      "https://wwwnc.cdc.gov/travel/notices/level1/measles",
    );
  });

  it("persists the panel on the trip detail through the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });

    const before = await gateway.getTrip(trip.id);
    expect(before.advisoryPanel).toBeUndefined();

    const panel = await gateway.fetchAdvisories({
      tripId: trip.id,
      countrySlug: "japan",
    });
    expect(panel.countryName).toBe("Japan");
    expect(panel.retrievedAt).toBeTruthy();
    expect(panel.entries.map((entry) => entry.source)).toEqual([
      "uk-fcdo",
      "us-state",
      "ca-gac",
      "de-aa",
    ]);
    expect(panel.sourceStatus.every((status) => status.state === "fresh")).toBe(
      true,
    );

    const after = await gateway.getTrip(trip.id);
    expect(after.advisoryPanel?.countrySlug).toBe("japan");

    await expect(
      gateway.fetchAdvisories({ tripId: trip.id, countrySlug: "atlantis" }),
    ).rejects.toMatchObject({ code: "validation/invalid_input" });

    await gateway.updateTrip(trip.id, { destination: "Oslo" });
    expect((await gateway.getTrip(trip.id)).advisoryPanel).toBeUndefined();
  });
});
