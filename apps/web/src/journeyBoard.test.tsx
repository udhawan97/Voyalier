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

    fireEvent.click(
      within(board).getByRole("button", {
        name: /Show in Plan:.*Depart — Fictional Pacific FP18/,
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "confirmed_fact",
      ),
    );
    expect(globalThis.location.href).not.toContain(
      document.activeElement?.getAttribute("data-search-record") ?? "missing",
    );
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
});
