import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

/**
 * The Today panel summarizes where the trip stands and what's next. The mock's
 * fixed "today" places the Kyoto trip in the future.
 */
describe("Today panel", () => {
  afterEach(() => setLocalePreference("en"));

  it("shows the trip phase and the next upcoming anchor", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });

    const today = await screen.findByRole("region", { name: "Today" });

    // Future trip → an "upcoming" phase and no plans today.
    expect(within(today).getByText(/Starts in \d+ days/)).toBeInTheDocument();
    expect(within(today).getByText("No plans for today.")).toBeInTheDocument();

    // The next anchor is the outbound flight departure.
    expect(within(today).getByText("Next")).toBeInTheDocument();
    expect(within(today).getByText(/Depart —.*FP18/)).toBeInTheDocument();

    fireEvent.click(
      within(today).getByRole("button", {
        name: /Show in Plan: Depart —.*FP18/,
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "confirmed_fact",
      ),
    );
    const recordId = document.activeElement?.getAttribute("data-search-record");
    expect(recordId).toBeTruthy();
    expect(globalThis.location.href).not.toContain(recordId!);
  });

  it("opens the traveler-authored plan behind the next item", async () => {
    const gateway = createMockGateway();
    await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Choose tea bowls",
      location: "Gion",
      startAt: "2026-08-01T10:00",
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );

    const today = await screen.findByRole("region", { name: "Today" });
    fireEvent.click(
      within(today).getByRole("button", {
        name: "Show in Plan: Choose tea bowls · 10:00 AM",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "trip_item",
      ),
    );
    expect(document.activeElement).toHaveTextContent("Choose tea bowls");
  });

  it("keeps older Today responses readable when source identity is absent", async () => {
    const base = createMockGateway();
    const gateway = {
      ...base,
      getToday: async (tripId: string) => {
        const view = await base.getToday(tripId);
        const withoutTarget = (item: (typeof view.today)[number]) => {
          const olderItem = { ...item };
          delete olderItem.target;
          return olderItem;
        };
        return {
          ...view,
          today: view.today.map(withoutTarget),
          next: view.next ? withoutTarget(view.next) : undefined,
        };
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );

    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText(/Depart —.*FP18/)).toBeInTheDocument();
    expect(
      within(today).queryByRole("button", { name: /Show in Plan/ }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the owning section when a projected record disappeared", async () => {
    const base = createMockGateway();
    const gateway = {
      ...base,
      getToday: async (tripId: string) => {
        const view = await base.getToday(tripId);
        return view.next
          ? {
              ...view,
              next: {
                ...view.next,
                target: {
                  source: "confirmed_fact" as const,
                  recordId: "missing-confirmed-fact",
                },
              },
            }
          : view;
      },
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );

    const today = await screen.findByRole("region", { name: "Today" });
    fireEvent.click(
      within(today).getByRole("button", {
        name: /Show in Plan: Depart —.*FP18/,
      }),
    );
    await waitFor(
      () => expect(document.getElementById("blueprint-title")).toHaveFocus(),
      { timeout: 2_000 },
    );
    expect(
      screen.getByText(
        "That confirmed reservation is no longer available. Blueprint opened.",
      ),
    ).toBeInTheDocument();
    expect(globalThis.location.href).not.toContain("missing-confirmed-fact");
  });

  it("localizes product-owned item labels while preserving source text", async () => {
    setLocalePreference("es");
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );

    const today = await screen.findByRole("region", { name: "Hoy" });
    expect(within(today).getByText(/Salida —.*FP18/)).toBeInTheDocument();
    expect(within(today).queryByText(/Depart —/)).not.toBeInTheDocument();
    expect(
      within(today).getByRole("button", {
        name: /Mostrar en Plan: Salida —.*FP18/,
      }),
    ).toBeInTheDocument();
  });
});
