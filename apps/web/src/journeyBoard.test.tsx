import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

describe("Journey Board", () => {
  afterEach(() => setLocalePreference("en"));

  it("keeps departure, arrival, stay nights, and source focus distinct", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const board = await screen.findByRole("region", { name: "Journey Board" });

    expect(within(board).getByText("Nov 3, 2026")).toBeInTheDocument();
    expect(within(board).getByText("Nov 4, 2026")).toBeInTheDocument();
    expect(
      within(board).getByText(/Depart — Fictional Pacific FP18/),
    ).toBeInTheDocument();
    expect(
      within(board).getByText(/Arrive — Fictional Pacific FP18/),
    ).toBeInTheDocument();
    expect(
      within(board).getAllByText(/Staying at River Paper Inn/),
    ).not.toHaveLength(0);
    expect(
      within(board).getAllByText("Confirmed evidence").length,
    ).toBeGreaterThan(0);

    const trigger = within(board).getByRole("button", {
      name: /Show in Plan:.*Depart — Fictional Pacific FP18/,
    });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "confirmed_fact",
      ),
    );
    expect(globalThis.location.href).not.toContain(
      document.activeElement?.getAttribute("data-search-record") ?? "missing",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Journey Board" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("localizes the projection without changing stored titles", async () => {
    setLocalePreference("es");
    const gateway = createMockGateway();
    await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Tea bowls",
      startAt: "2026-11-05T10:00",
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );
    const board = await screen.findByRole("region", {
      name: "Itinerario diario",
    });
    expect(within(board).getByText(/Tea bowls/)).toBeInTheDocument();
    expect(
      within(board).getByText(/Salida — Fictional Pacific FP18/),
    ).toBeInTheDocument();
  });

  it("keeps opaque plan focus and calendar identity stable across edits", async () => {
    const gateway = createMockGateway();
    const item = await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Tea bowls",
      startAt: "2026-11-05T10:00",
      notes: "first note",
    });
    const before = await gateway.getTrip("trip_kyoto");
    const beforeEntry = before.journeyBoard.days
      .flatMap((day) => day.entries)
      .find((entry) => entry.target.recordId === item.id)!;
    const beforeEvent = before.calendarSnapshot.events.find(
      (event) => event.title === "Tea bowls",
    )!;

    await gateway.updateTripItem({
      tripItemId: item.id,
      kind: item.kind,
      title: item.title,
      startAt: item.startAt,
      notes: "note-only edit",
    });
    const noteOnly = await gateway.getTrip("trip_kyoto");
    const noteOnlyEvent = noteOnly.calendarSnapshot.events.find(
      (event) => event.title === "Tea bowls",
    )!;
    expect(noteOnlyEvent).toEqual(beforeEvent);

    await gateway.updateTripItem({
      tripItemId: item.id,
      kind: item.kind,
      title: "Tea ceremony",
      startAt: item.startAt,
      notes: "note-only edit",
    });
    const changed = await gateway.getTrip("trip_kyoto");
    const changedEntry = changed.journeyBoard.days
      .flatMap((day) => day.entries)
      .find((entry) => entry.target.recordId === item.id)!;
    const changedEvent = changed.calendarSnapshot.events.find(
      (event) => event.title === "Tea ceremony",
    )!;
    expect(changedEntry.focusLocator).toBe(beforeEntry.focusLocator);
    expect(changedEvent.uid).toBe(beforeEvent.uid);
    expect(changedEvent.sequence).toBe(beforeEvent.sequence + 1);
  });
});
