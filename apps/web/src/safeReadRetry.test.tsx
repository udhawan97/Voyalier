import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { openFixtureTrip, renderApp } from "./test/helpers";

const offline = { code: "transport/failure" as const, message: "offline" };

describe("global Retry safe-read ownership", () => {
  it("replays notes, advice countries, and vault status exactly once without replaying actions", async () => {
    const base = createMockGateway();
    let notesCalls = 0;
    let countriesCalls = 0;
    let vaultCalls = 0;
    const getTripNotes = vi.fn((tripId: string) => {
      notesCalls += 1;
      return notesCalls === 1
        ? new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(offline), 400),
          )
        : base.getTripNotes(tripId);
    });
    const listAdviceCountries = vi.fn(() => {
      countriesCalls += 1;
      return countriesCalls === 1
        ? new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(offline), 400),
          )
        : base.listAdviceCountries();
    });
    const getVaultStatus = vi.fn(() => {
      vaultCalls += 1;
      return vaultCalls === 1
        ? new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(offline), 400),
          )
        : base.getVaultStatus();
    });
    const detectLocalAi = vi.fn(base.detectLocalAi);
    const runAssist = vi.fn(base.runAssist);
    const fetchAdvisories = vi.fn(base.fetchAdvisories);
    const fetchWeather = vi.fn(base.fetchWeather);
    const getOfflineMap = vi.fn(base.getOfflineMap);
    const setTripNotes = vi.fn(base.setTripNotes);

    renderApp({
      ...base,
      getTripNotes,
      listAdviceCountries,
      getVaultStatus,
      detectLocalAi,
      runAssist,
      fetchAdvisories,
      fetchWeather,
      getOfflineMap,
      setTripNotes,
    });
    await openFixtureTrip();
    await waitFor(() => {
      expect(getTripNotes).toHaveBeenCalledTimes(1);
      expect(listAdviceCountries).toHaveBeenCalledTimes(1);
      expect(getVaultStatus).toHaveBeenCalledTimes(1);
      expect(detectLocalAi).toHaveBeenCalled();
    });
    // All three delayed failures must settle before the click. Finding the
    // banner after only the earliest rejection would race subscription commit
    // for a deferred section and test mount timing instead of Retry ownership.
    await new Promise((resolve) => setTimeout(resolve, 450));
    const retry = screen.getByRole("button", { name: "Retry" });
    const localAiCalls = detectLocalAi.mock.calls.length;
    const mapCalls = getOfflineMap.mock.calls.length;

    fireEvent.click(retry);

    await waitFor(() => {
      expect(getTripNotes).toHaveBeenCalledTimes(2);
      expect(listAdviceCountries).toHaveBeenCalledTimes(2);
      expect(getVaultStatus).toHaveBeenCalledTimes(2);
    });

    const notes = await screen.findByRole("region", { name: "Notes" });
    expect(await within(notes).findByLabelText("Trip notes")).toBeVisible();
    const advice = await screen.findByRole("region", {
      name: "Official travel advice",
    });
    expect(
      await within(advice).findByRole("option", { name: "Japan" }),
    ).toBeInTheDocument();

    expect(detectLocalAi).toHaveBeenCalledTimes(localAiCalls);
    expect(getOfflineMap).toHaveBeenCalledTimes(mapCalls);
    expect(runAssist).not.toHaveBeenCalled();
    expect(fetchAdvisories).not.toHaveBeenCalled();
    expect(fetchWeather).not.toHaveBeenCalled();
    expect(setTripNotes).not.toHaveBeenCalled();
  });

  it("keeps prior notes visible when their recovery read fails", async () => {
    const base = createMockGateway();
    await base.setTripNotes("trip_kyoto", "Keep the paper ticket");
    let notesCalls = 0;
    const getTripNotes = vi.fn((tripId: string) => {
      notesCalls += 1;
      return notesCalls === 2
        ? Promise.reject(offline)
        : base.getTripNotes(tripId);
    });
    const searchTrip = vi.fn(() => Promise.reject(offline));
    renderApp({ ...base, getTripNotes, searchTrip });
    await openFixtureTrip();
    const notes = await screen.findByRole("region", { name: "Notes" });
    const field = await within(notes).findByLabelText("Trip notes");
    expect(field).toHaveValue("Keep the paper ticket");

    const search = await screen.findByRole("region", {
      name: "Find in this trip",
    });
    fireEvent.change(
      within(search).getByLabelText(
        "Search documents, confirmed plans, and saved research",
      ),
      { target: { value: "paper" } },
    );
    await waitFor(() => expect(searchTrip).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getTripNotes).toHaveBeenCalledTimes(2));
    expect(field).toHaveValue("Keep the paper ticket");
    expect(searchTrip).toHaveBeenCalledTimes(1);
  });
});
