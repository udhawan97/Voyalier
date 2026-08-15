import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import {
  failingGateway,
  openFixtureTrip,
  rejectWith,
  renderApp,
} from "./test/helpers";

async function fillAndSubmitCreate() {
  fireEvent.click(await screen.findByRole("button", { name: "Create a trip" }));
  const dialog = await screen.findByRole("dialog", { name: "Create a trip" });
  fireEvent.change(within(dialog).getByLabelText("From"), {
    target: { value: "Chicago" },
  });
  fireEvent.change(within(dialog).getByLabelText("To"), {
    target: { value: "Kyoto" },
  });
  fireEvent.change(within(dialog).getByLabelText("Start date"), {
    target: { value: "2027-06-01" },
  });
  fireEvent.change(within(dialog).getByLabelText("End date"), {
    target: { value: "2027-06-05" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create trip" }));
  return dialog;
}

async function submitImport() {
  fireEvent.click(await screen.findByRole("button", { name: "Import" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Import a document",
  });
  fireEvent.change(within(dialog).getByLabelText("Content"), {
    target: { value: "Some confirmation content." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
  return dialog;
}

describe("AppError rendered states", () => {
  it("validation/invalid_input maps to the offending field", async () => {
    renderApp(
      failingGateway({
        createTrip: rejectWith({
          code: "validation/invalid_input",
          message: "origin must be between 1 and 120 characters",
          details: { field: "origin" },
        }),
      }),
    );
    await fillAndSubmitCreate();
    expect(
      await screen.findByText("Enter a valid trip origin."),
    ).toBeInTheDocument();
  });

  it("validation/invalid_date_range renders on the date fields", async () => {
    renderApp(
      failingGateway({
        createTrip: rejectWith({
          code: "validation/invalid_date_range",
          message: "startDate must be on or before endDate",
        }),
      }),
    );
    await fillAndSubmitCreate();
    expect(
      await screen.findByText("Use a valid date range with the start first."),
    ).toBeInTheDocument();
  });

  it("trip/not_found shows a recovery state in the Blueprint", async () => {
    renderApp(
      failingGateway({
        getTrip: rejectWith({ code: "trip/not_found", message: "gone" }),
      }),
    );
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByText("This trip is no longer here"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to trips" }),
    ).toBeInTheDocument();
  });

  it("candidate/not_found surfaces on the review card", async () => {
    renderApp(
      failingGateway({
        confirmCandidate: rejectWith({
          code: "candidate/not_found",
          message: "missing",
        }),
      }),
    );
    await openFixtureTrip();
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Confirm" })[0],
    );
    expect(
      await within(dialog).findByText("This suggestion is no longer here"),
    ).toBeInTheDocument();
  });

  it("candidate/already_resolved surfaces on dismiss", async () => {
    renderApp(
      failingGateway({
        rejectCandidate: rejectWith({
          code: "candidate/already_resolved",
          message: "resolved",
        }),
      }),
    );
    await openFixtureTrip();
    fireEvent.click(
      await screen.findByRole("button", { name: /Review 3 suggestions/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    // Dismiss is a two-step confirm: arm, then confirm.
    const dismiss = within(dialog).getAllByRole("button", {
      name: "Dismiss",
    })[0];
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);
    expect(
      await within(dialog).findByText("Already resolved"),
    ).toBeInTheDocument();
  });

  it("shows a failed archive on the trip list too, not just to the reader", async () => {
    renderApp(
      failingGateway({
        archiveTrip: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    const card = (
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" })
    ).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /^Archive\b/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Local storage is unavailable");
  });

  it("shows a failed archive to the eye, not just the screen reader", async () => {
    // These header actions used to only announce their failures, so a sighted
    // user watched the button un-busy itself and saw nothing.
    renderApp(
      failingGateway({
        archiveTrip: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    await openFixtureTrip();
    fireEvent.click(screen.getByRole("button", { name: /^Archive\b/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Local storage is unavailable");
  });

  it("fact/not_found is announced when unconfirming", async () => {
    renderApp(
      failingGateway({
        unconfirmFact: rejectWith({ code: "fact/not_found", message: "gone" }),
      }),
    );
    await openFixtureTrip();
    const factCard = (await screen.findByText("Flight FP18")).closest(
      "article",
    ) as HTMLElement;
    // FP18 is a hand-entered (manual) fact, so the action is a "Remove" that
    // takes a two-step confirm (arm, then confirm).
    const remove = within(factCard).getByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(
      await screen.findByText("This fact is no longer here"),
    ).toBeInTheDocument();
  });

  it("document/too_large renders inline in import", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/too_large",
          message: "too big",
        }),
      }),
    );
    await openFixtureTrip();
    await submitImport();
    expect(
      await screen.findByText(/over the 1,000,000 character limit/),
    ).toBeInTheDocument();
  });

  it("document/duplicate warns without exposing the internal document id", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/duplicate",
          message: "dupe",
          details: { existingDocumentId: "document_kyoto_confirmations" },
        }),
      }),
    );
    await openFixtureTrip();
    await submitImport();
    expect(await screen.findByText("Already imported")).toBeInTheDocument();
    // The internal document id is a debug token and must not reach the user.
    expect(
      screen.queryByText(/document_kyoto_confirmations/),
    ).not.toBeInTheDocument();
  });

  it("document/empty renders inline in import", async () => {
    renderApp(
      failingGateway({
        importDocument: rejectWith({
          code: "document/empty",
          message: "empty",
        }),
      }),
    );
    await openFixtureTrip();
    await submitImport();
    expect(
      await screen.findByText("The pasted content was empty."),
    ).toBeInTheDocument();
  });

  it("storage/failure renders a retryable banner on the trip list", async () => {
    renderApp(
      failingGateway({
        listTrips: rejectWith({ code: "storage/failure", message: "disk" }),
      }),
    );
    expect(
      await screen.findByText("Local storage is unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("transport/failure shows the offline banner", async () => {
    renderApp(
      failingGateway({
        health: rejectWith({ code: "transport/failure", message: "down" }),
      }),
    );
    expect(
      await screen.findByText("Voyalier can't reach its engine"),
    ).toBeInTheDocument();
  });

  it("lets the workspace banner own a trip-list transport failure", async () => {
    const down = rejectWith({
      code: "transport/failure",
      message: "engine unreachable",
    });
    renderApp(failingGateway({ health: down, listTrips: down }));

    await screen.findByText("Offline");
    expect(screen.getAllByText("Voyalier can't reach its engine")).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("keeps a trip-list action transport failure under the same owner", async () => {
    const { gateway, state } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    state.offline = true;

    fireEvent.click(
      (await screen.findAllByRole("button", { name: /^Archive\b/ }))[0],
    );

    await screen.findByText("Offline");
    expect(screen.getAllByText("Voyalier can't reach its engine")).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("lets the workspace banner own a Search transport failure and recovery", async () => {
    const { gateway, state } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    state.offline = true;

    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Kyoto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Offline");
    expect(screen.getAllByText("Voyalier can't reach its engine")).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);

    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    expect(screen.queryByText("Voyalier can't reach its engine")).toBeNull();
  });

  it("keeps a non-transport Search failure local", async () => {
    renderApp(
      failingGateway({
        searchWorkspace: rejectWith({
          code: "storage/failure",
          message: "database unavailable",
        }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Kyoto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Local storage is unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("keeps shell health aligned with a failed trip load and its recovery", async () => {
    const base = createMockGateway();
    let offline = false;
    const gateway = {
      ...base,
      getTrip: (tripId: string) =>
        offline
          ? Promise.reject({
              code: "transport/failure",
              message: "engine unreachable",
            })
          : base.getTrip(tripId),
    };

    renderApp(gateway);
    await screen.findByText("Ready");
    offline = true;
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );

    await screen.findByText("Offline");
    expect(
      screen.getAllByText("Voyalier can't reach its engine").length,
    ).toBeGreaterThan(0);

    offline = false;
    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("internal/unexpected renders a generic recovery banner", async () => {
    renderApp(
      failingGateway({
        listTrips: rejectWith({
          code: "internal/unexpected",
          message: "boom",
        }),
      }),
    );
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  // The audit's gap #9: with the engine down on load and a trip open, the
  // app-level banner and the trip view's own load error rendered the identical
  // message and Retry, stacked. Either one recovered fully; there were just two
  // of them.
  it("shows one engine-unreachable banner, not two", async () => {
    const down = rejectWith({
      code: "transport/failure",
      message: "The local core could not be reached.",
    });
    // Land on the trip view the way a reload with an active trip does.
    globalThis.sessionStorage?.setItem("voyalier-active-trip", "trip_kyoto");
    renderApp(
      failingGateway({
        health: down,
        getTrip: down,
        listCandidates: down,
      }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByText("Voyalier can't reach its engine").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Voyalier can't reach its engine")).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  /**
   * A gateway whose engine can be pulled out from under the app.
   *
   * Failing one method is not the same condition: everything else keeps
   * succeeding and reports the transport healthy again, which is correct. The
   * state these two tests are about is the engine being gone, so every call
   * goes with it.
   */
  function unpluggableGateway() {
    const base = createMockGateway();
    const state = { offline: false };
    const searchQueries: string[] = [];
    const gateway = new Proxy(base, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (property === "searchWorkspace") {
            searchQueries.push(String(args[0]));
          }
          return state.offline
            ? Promise.reject({
                code: "transport/failure",
                message: "engine unreachable",
              })
            : (value as (...rest: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    return { gateway, state, searchQueries };
  }

  /**
   * The same duplicate, on the path an *action* takes.
   *
   * The load path grew the guard above; the action banner a few lines below it
   * in the same view never did. Archiving with the engine down printed the
   * identical sentence twice — once with a Retry and once without.
   */
  it("shows one engine-unreachable banner when an action fails too", async () => {
    const { gateway, state } = unpluggableGateway();
    renderApp(gateway);
    await openFixtureTrip();

    state.offline = true;
    fireEvent.click(screen.getByRole("button", { name: /^Archive\b/ }));

    await screen.findByText("Offline");
    // Scoped to the banner component on purpose. Individual panels below still
    // report their own load failure in their own line, which is them saying
    // what *they* could not fetch; the defect was the trip repeating the
    // workspace's banner, verbatim and without its Retry.
    const banners = screen
      .getAllByText("Voyalier can't reach its engine")
      .filter((node) => node.closest(".voy-banner"));
    expect(banners).toHaveLength(1);
  });

  /**
   * Retry has to clear what it just disproved.
   *
   * Measured on the running product: after a successful Retry the topbar read
   * Ready and the workspace banner was gone, while the trip still carried
   * "Voyalier can't reach its engine" with no Retry and no way to dismiss it.
   * `useAsyncAction` only clears its error when the next run starts, and
   * nothing connected a recovered transport to that state.
   */
  it("clears an action's transport error once the engine answers again", async () => {
    const { gateway, state } = unpluggableGateway();
    renderApp(gateway);
    await openFixtureTrip();

    state.offline = true;
    fireEvent.click(screen.getByRole("button", { name: /^Archive\b/ }));
    await screen.findByText("Offline");

    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    await waitFor(() =>
      expect(
        screen.queryByText("Voyalier can't reach its engine"),
      ).not.toBeInTheDocument(),
    );
  });

  it("replays the exact transport-failed Search once after global recovery", async () => {
    const { gateway, state, searchQueries } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    state.offline = true;
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Offline");
    expect(searchQueries).toEqual(["Kyoto"]);

    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Kyoto confirmations")).toBeInTheDocument();
    await waitFor(() => expect(searchQueries).toEqual(["Kyoto", "Kyoto"]));
    expect(await screen.findByText(/matches? in this workspace/i)).toHaveRole(
      "status",
    );
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("does not replay a failed Search after the query is cleared", async () => {
    const { gateway, state, searchQueries } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    state.offline = true;
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Offline");

    fireEvent.change(input, { target: { value: "" } });
    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Ready");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(searchQueries).toEqual(["Kyoto"]);
  });

  it("never replays an older failed query after a newer query takes over", async () => {
    const { gateway, state, searchQueries } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    state.offline = true;
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Offline");

    fireEvent.change(input, { target: { value: "FP18" } });
    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("ORD → HND")).toBeInTheDocument();
    await waitFor(() => expect(searchQueries).toEqual(["Kyoto", "FP18"]));
  });

  it("a newer manual Search success consumes the old replay eligibility", async () => {
    const { gateway, state, searchQueries } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    state.offline = true;
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Offline");

    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Kyoto confirmations")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(searchQueries).toEqual(["Kyoto", "Kyoto"]);
  });

  it("hides results that belong to an older query when the next Search fails", async () => {
    const { gateway, state } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Kyoto confirmations")).toBeInTheDocument();

    state.offline = true;
    fireEvent.change(input, { target: { value: "Fjord" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Offline");
    expect(screen.queryByText("Kyoto confirmations")).not.toBeInTheDocument();
  });

  it("does not replay a failed Search after leaving the Search view", async () => {
    const { gateway, state, searchQueries } = unpluggableGateway();
    renderApp(gateway);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const input = await screen.findByLabelText("Search all trips");
    state.offline = true;
    fireEvent.change(input, { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Offline");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    state.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(searchQueries).toEqual(["Kyoto"]);
  });
});
