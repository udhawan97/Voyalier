import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, rejectWith, renderApp } from "./test/helpers";

async function openKyoto() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
}

describe("User-flow gap fixes", () => {
  // #1 — a hand-entered fact is a "Remove", announced honestly, not a bogus
  // "moved back to review".
  it("labels manual-fact removal honestly", async () => {
    renderApp(createMockGateway());
    await openKyoto();
    const factCard = (await screen.findByText("Flight FP18")).closest(
      "article",
    ) as HTMLElement;
    // Manual facts show Remove, not Unconfirm.
    expect(
      within(factCard).queryByRole("button", { name: "Unconfirm" }),
    ).toBeNull();
    // Remove is a two-step confirm on a manual fact (arm, then confirm).
    const remove = within(factCard).getByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    fireEvent.click(remove);

    expect(await screen.findByText("Flight FP18 removed.")).toBeInTheDocument();
    expect(screen.queryByText("Flight FP18 moved back to review.")).toBeNull();
  });

  // #4 — a trip's destination can be edited after creation.
  it("edits a trip's destination", async () => {
    renderApp(createMockGateway());
    await openKyoto();
    expect(screen.getByText("Chicago → Kyoto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit trip" });
    const destination = within(dialog).getByLabelText("To");
    fireEvent.change(destination, { target: { value: "Osaka" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(await screen.findByText("Chicago → Osaka")).toBeInTheDocument();
  });

  // #5 — archived trips are hidden by default, revealable, and reversible.
  it("hides archived trips and lets you unarchive them", async () => {
    renderApp(createMockGateway());
    // The archived Oslo trip is hidden by default.
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" });
    expect(
      screen.queryByRole("button", { name: "Open Archived Oslo notes" }),
    ).toBeNull();

    // Reveal archived trips.
    fireEvent.click(
      await screen.findByRole("button", { name: "Show 1 archived trip" }),
    );
    const oslo = (
      await screen.findByRole("button", { name: "Open Archived Oslo notes" })
    ).closest("article") as HTMLElement;

    // Unarchive it → it moves back into the active workspace.
    fireEvent.click(within(oslo).getByRole("button", { name: "Unarchive" }));
    expect(
      await screen.findByText("Archived Oslo notes unarchived."),
    ).toBeInTheDocument();
    // No archived trips remain, so the toggle is gone.
    expect(
      screen.queryByRole("button", { name: /Show .* archived/ }),
    ).toBeNull();
  });

  // #6 — an unreachable on-device AI gets clear "is Ollama running?" guidance.
  it("gives clear guidance when the AI is unreachable", async () => {
    renderApp(
      failingGateway({
        runAssist: rejectWith({
          code: "assist/unreachable",
          message: "could not reach the AI provider: connection refused",
        }),
      }),
    );
    await openKyoto();
    const region = await screen.findByRole("region", {
      name: "Preview an AI request",
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Preview request" }),
    );
    fireEvent.click(
      await within(region).findByRole("button", {
        name: "Run on-device assist",
      }),
    );
    expect(
      await within(region).findByText(/make sure Ollama is running/),
    ).toBeInTheDocument();
  });

  // #7 — a weather lookup failure shows localized weather recovery copy, not
  // travel-advice wording or raw backend prose.
  it("shows a weather-specific error, not advice copy", async () => {
    renderApp(
      failingGateway({
        fetchWeather: rejectWith({
          code: "weather/fetch_failed",
          message:
            "the weather source could not find that destination on the map",
        }),
      }),
    );
    await openKyoto();
    const region = await screen.findByRole("region", {
      name: "Weather outlook",
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Fetch weather outlook" }),
    );
    expect(
      await within(region).findByText("Couldn't get the weather outlook"),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/Check the destination and your connection/),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/weather source/)).toBeNull();
    expect(within(region).queryByText(/the advice page/)).toBeNull();
  });

  // The audit's gap #5: closing a dialog could drop focus on <body>, so a
  // keyboard user restarted from the top of the page. Two causes — the trigger
  // is unmounted by the very action that closed the dialog, and StrictMode
  // replays the mount effect and re-captures a focus target the dialog itself
  // already owns.
  it("never strands focus on the body when a dialog closes", async () => {
    renderApp(createMockGateway());
    await openKyoto();

    // Cancel: the trigger survives, so focus belongs back on it.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit trip" });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);

    // Escape closes it too, and must also leave focus somewhere reachable.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const again = await screen.findByRole("dialog", { name: "Edit trip" });
    fireEvent.keyDown(again, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
  });

  // Same gap, the harder half: the empty state's Create button unmounts the
  // moment the trip exists, so the captured trigger is gone by the time focus
  // should return to it.
  it("keeps focus reachable when the trigger itself disappears", async () => {
    renderApp(failingGateway({ listTrips: () => Promise.resolve([]) }));
    const create = await screen.findAllByRole("button", {
      name: "Create a trip",
    });
    fireEvent.click(create[create.length - 1]);
    const dialog = await screen.findByRole("dialog", { name: "Create a trip" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
  });

  // The audit's gap #8: after a failed submit, a field kept its red error while
  // holding a perfectly valid value, until the next submit.
  it("clears a field error as soon as that field becomes valid", async () => {
    renderApp(failingGateway({ listTrips: () => Promise.resolve([]) }));
    const buttons = await screen.findAllByRole("button", {
      name: "Create a trip",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    const dialog = await screen.findByRole("dialog", { name: "Create a trip" });

    // Submitting empty is what raises them in the first place.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create trip" }),
    );
    expect(
      await within(dialog).findByText("Enter where the trip starts."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Add both a start and end date."),
    ).toBeInTheDocument();

    // Fixing one field clears that field, and only that field.
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "San Francisco" },
    });
    await waitFor(() =>
      expect(
        within(dialog).queryByText("Enter where the trip starts."),
      ).toBeNull(),
    );
    expect(
      within(dialog).getByText("Enter where the trip goes."),
    ).toBeInTheDocument();

    // Dates clear only once both are present and in order.
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2026-10-12" },
    });
    expect(
      within(dialog).getByText("Add both a start and end date."),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2026-10-26" },
    });
    await waitFor(() =>
      expect(
        within(dialog).queryByText("Add both a start and end date."),
      ).toBeNull(),
    );
  });
});
