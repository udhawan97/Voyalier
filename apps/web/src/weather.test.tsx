import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The weather outlook is fetched on an explicit click, names exactly what
 * leaves the device, reports forecast coverage honestly, and carries the
 * Open-Meteo CC BY 4.0 attribution.
 */
describe("weather outlook", () => {
  it("fetches an outlook on click and renders days with attribution", async () => {
    renderApp(createMockGateway());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const weather = await screen.findByRole("region", {
      name: "Weather outlook",
    });

    // Consent copy names the destination and the endpoint before any fetch.
    expect(
      within(weather).getByText(/sends your destination name \(“Kyoto”\)/),
    ).toBeInTheDocument();
    expect(within(weather).getByText(/open-meteo\.com/)).toBeInTheDocument();

    fireEvent.click(
      within(weather).getByRole("button", { name: "Fetch weather outlook" }),
    );

    // Days render with deterministic descriptions and metric temps.
    expect(await within(weather).findByText("Light rain")).toBeInTheDocument();
    expect(within(weather).getByText(/75% rain/)).toBeInTheDocument();
    // Partial coverage is disclosed, not padded.
    expect(
      within(weather).getByText(/only the first part of your trip is covered/),
    ).toBeInTheDocument();
    // Required attribution and licence.
    const attribution = within(weather).getByRole("link", {
      name: /Weather data by Open-Meteo\.com/,
    });
    expect(attribution).toHaveAttribute("href", "https://open-meteo.com/");
    expect(within(weather).getByText(/CC BY 4\.0/)).toBeInTheDocument();
    expect(
      within(weather).getByRole("button", { name: "Fetch again" }),
    ).toBeInTheDocument();
  });

  it("persists the snapshot on the trip detail through the gateway", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Sapporo",
      startDate: "2027-02-01",
      endDate: "2027-02-02",
    });

    const before = await gateway.getTrip(trip.id);
    expect(before.weather).toBeUndefined();

    const snapshot = await gateway.fetchWeather(trip.id);
    expect(snapshot.placeName).toBe("Sapporo");
    // Two-day trip: the fixture covers start..start+2 clipped to the window.
    expect(snapshot.days.length).toBe(2);
    expect(snapshot.days[0].date).toBe("2027-02-01");

    const after = await gateway.getTrip(trip.id);
    expect(after.weather?.placeName).toBe("Sapporo");
    expect(after.weather?.retrievedAt).toBeTruthy();

    await gateway.updateTrip(trip.id, { title: "Snow festival" });
    expect((await gateway.getTrip(trip.id)).weather).toBeDefined();

    await gateway.updateTrip(trip.id, { destination: "Oslo" });
    expect((await gateway.getTrip(trip.id)).weather).toBeUndefined();
  });
});

/**
 * The layers hung off the same click: what these dates are usually like, the
 * UV and air quality, official alerts, and what to pack. Each is evidence the
 * reader can check, not a verdict.
 */
describe("weather layers", () => {
  async function fetchOutlook() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const weather = await screen.findByRole("region", {
      name: "Weather outlook",
    });
    fireEvent.click(
      within(weather).getByRole("button", { name: "Fetch weather outlook" }),
    );
    await within(weather).findByText(/Partly cloudy/);
    return weather;
  }

  it("shows what the dates are typically like, with the sample behind it", async () => {
    const weather = await fetchOutlook();
    // The averages are worthless without the history behind them, so the
    // sample size rides along.
    expect(within(weather).getByText(/Typically 4–16°C/)).toBeInTheDocument();
    expect(
      within(weather).getByText(/100 days across 10 years \(2016–2025\)/),
    ).toBeInTheDocument();
    expect(
      within(weather).getByText(/44% of days see rain/),
    ).toBeInTheDocument();
  });

  it("shows UV and air quality per day", async () => {
    const weather = await fetchOutlook();
    expect(within(weather).getByText("UV 8.2")).toBeInTheDocument();
    expect(within(weather).getByText("AQI 58")).toBeInTheDocument();
  });

  it("suggests what to pack and names the reading behind each suggestion", async () => {
    const weather = await fetchOutlook();
    expect(
      within(weather).getByRole("heading", { name: "What to pack" }),
    ).toBeInTheDocument();
    // Cold (4.1C typical low) and wet (44% of days) → layers and a shell.
    expect(within(weather).getByText("Warm layers")).toBeInTheDocument();
    expect(
      within(weather).getByText(/Typical low is 4.1°C/),
    ).toBeInTheDocument();
    expect(within(weather).getByText("Rain shell")).toBeInTheDocument();
    expect(
      within(weather).getByText(/44% of typical days see rain/),
    ).toBeInTheDocument();
    // UV peaks at 8.2 → sun protection.
    expect(within(weather).getByText("Sun protection")).toBeInTheDocument();
    // AQI peaks at 58, well under 100 → no mask suggestion.
    expect(within(weather).queryByText("A mask")).toBeNull();
  });

  it("says nothing about alerts outside the United States", async () => {
    const weather = await fetchOutlook();
    // The NWS covers the US only. Kyoto gets no alert block at all, rather
    // than an empty one that would read as "all clear".
    expect(within(weather).queryByText(/Official alerts/)).toBeNull();
  });
});
