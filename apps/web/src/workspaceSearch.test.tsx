import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { WorkspaceSearchHit } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";
import { vi } from "vitest";

import { setLocalePreference } from "./app/locale";
import { openFixtureTrip, renderApp } from "./test/helpers";
import { tripSectionForSearchSource } from "./views/TripDetailView";

describe("workspace search", () => {
  afterEach(() => setLocalePreference("en"));

  it("maps every search source to its durable owning section", () => {
    expect(tripSectionForSearchSource("document")).toBe("section-prepare");
    expect(tripSectionForSearchSource("note")).toBe("section-prepare");
    expect(tripSectionForSearchSource("resource")).toBe("section-prepare");
    expect(tripSectionForSearchSource("confirmed_fact")).toBe("section-plan");
    expect(tripSectionForSearchSource("saved_place")).toBe("section-plan");
    expect(tripSectionForSearchSource("trip_item")).toBe("section-plan");
  });

  it("explains and disables an empty or whitespace-only search", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    const submit = screen.getByRole("button", { name: "Search" });
    const hint = screen.getByText("Enter a search term to enable Search.");

    expect(submit).toBeDisabled();
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);

    fireEvent.change(input, { target: { value: "   " } });
    expect(submit).toBeDisabled();
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);

    fireEvent.change(input, { target: { value: "Maple" } });
    expect(submit).toBeEnabled();
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText("Enter a search term to enable Search."),
    ).toBeNull();
  });

  it("localizes the empty-search guidance in Spanish", async () => {
    setLocalePreference("es");
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Buscar en el espacio de trabajo",
      }),
    );

    const input = screen.getByLabelText("Buscar en todos los viajes");
    const hint = screen.getByText(
      "Escribe un término de búsqueda para activar Buscar.",
    );
    expect(screen.getByRole("button", { name: "Buscar" })).toBeDisabled();
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("runs a trimmed valid query from both form Enter and the Search button", async () => {
    const base = createMockGateway();
    const searchWorkspace = vi.fn((query: string) =>
      base.searchWorkspace(query),
    );
    renderApp({ ...base, searchWorkspace });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "  Maple Lantern  " } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(searchWorkspace).toHaveBeenCalledWith("Maple Lantern"),
    );

    fireEvent.change(input, { target: { value: "  Fjord  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledWith("Fjord"));
  });

  it.each([
    ["document", "section-prepare"],
    ["note", "section-prepare"],
    ["resource", "section-prepare"],
    ["confirmed_fact", "section-plan"],
    ["saved_place", "section-plan"],
    ["trip_item", "section-plan"],
  ] as const)(
    "writes and reloads the owning section for a same-trip %s result",
    async (source, section) => {
      const base = createMockGateway();
      const gateway = {
        ...base,
        searchWorkspace: async () => [
          {
            source,
            tripId: "trip_kyoto",
            tripTitle: "Kyoto autumn journey",
            tripStatus: "draft" as const,
            tripUpdatedAt: "2026-01-01T00:00:00Z",
            recordId: `same-${source}`,
            label: `Same ${source}`,
            snippet: "same trip result",
            score: 1,
          },
        ],
      };
      const first = renderApp(gateway);
      await openFixtureTrip();
      window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

      fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
      fireEvent.change(await screen.findByLabelText("Search all trips"), {
        target: { value: "same" },
      });
      fireEvent.click(
        (await screen.findByText("Kyoto autumn journey")).closest("button")!,
      );

      await waitFor(() => expect(window.location.hash).toBe(`#${section}`));
      expect(window.location.search).toBe("?trip=trip_kyoto");
      expect(window.location.href).not.toContain(`same-${source}`);
      first.unmount();
      renderApp(gateway);
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      });
      expect(window.location.hash).toBe(`#${section}`);
    },
  );

  it.each([
    ["document", "section-prepare"],
    ["note", "section-prepare"],
    ["resource", "section-prepare"],
    ["confirmed_fact", "section-plan"],
    ["saved_place", "section-plan"],
    ["trip_item", "section-plan"],
  ] as const)(
    "writes and reloads the owning section for a cross-trip %s result",
    async (source, section) => {
      const base = createMockGateway();
      const gateway = {
        ...base,
        searchWorkspace: async () => [
          {
            source,
            tripId: "trip_oslo",
            tripTitle: "Archived Oslo notes",
            tripStatus: "archived" as const,
            tripUpdatedAt: "2026-01-01T00:00:00Z",
            recordId: `cross-${source}`,
            label: `Cross ${source}`,
            snippet: "different trip result",
            score: 1,
          },
        ],
      };
      const first = renderApp(gateway);
      await openFixtureTrip();
      window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

      fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
      fireEvent.change(await screen.findByLabelText("Search all trips"), {
        target: { value: "cross" },
      });
      fireEvent.click(
        (await screen.findByText("Archived Oslo notes")).closest("button")!,
      );

      await waitFor(() => expect(window.location.hash).toBe(`#${section}`));
      expect(window.location.search).toBe("?trip=trip_oslo");
      expect(window.location.href).not.toContain(`cross-${source}`);
      first.unmount();
      renderApp(gateway);
      await screen.findByRole("heading", {
        name: "Archived Oslo notes",
        level: 1,
      });
      expect(window.location.hash).toBe(`#${section}`);
    },
  );

  it("matches any query word and ranks records covering more words", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Maple museum route");
    await gateway.setTripNotes("trip_lisbon", "Maple viewpoints");

    const hits = await gateway.searchWorkspace("maple museum");

    expect(hits.filter((hit) => hit.source === "note")).toHaveLength(2);
    expect(hits[0].tripId).toBe("trip_kyoto");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("keeps the mock workspace corpus aligned with saved research", async () => {
    const gateway = createMockGateway();
    const resource = await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/workspace-resource",
      title: "Workspace reading",
      note: "Quiet temple photography",
      tags: ["tagonlyblossom"],
    });

    const expectsResource = async (query: string) =>
      expect(await gateway.searchWorkspace(query)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "resource",
            recordId: resource.id,
            label: "Workspace reading",
          }),
        ]),
      );

    await expectsResource("Workspace reading");
    await expectsResource("photography");
    await expectsResource("tagonlyblossom");

    await gateway.setResearchSettings({ autoFetchDetails: true });
    await gateway.fetchResourceDetails(resource.id);
    await expectsResource("fetched on request");
    await expectsResource("Readable text captured");

    await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://url-only-token.example.test/private-path",
      title: "Neutral reference",
      note: "",
      tags: [],
    });
    expect(await gateway.searchWorkspace("url-only-token")).toEqual([]);
  });

  it("does not let an older slow response replace a newer query", async () => {
    const base = createMockGateway();
    let resolveOld!: (hits: WorkspaceSearchHit[]) => void;
    const gateway = {
      ...base,
      searchWorkspace: (query: string) =>
        query === "Fjord"
          ? new Promise<WorkspaceSearchHit[]>((resolve) => {
              resolveOld = resolve;
            })
          : base.searchWorkspace(query),
    };
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    const submit = screen.getByRole("button", { name: "Search" });
    fireEvent.change(input, { target: { value: "Fjord" } });
    fireEvent.click(submit);
    fireEvent.change(input, { target: { value: "Maple Lantern" } });
    fireEvent.click(submit);
    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();

    await act(async () => {
      resolveOld([
        {
          source: "note",
          tripId: "trip_oslo",
          tripTitle: "Archived Oslo notes",
          tripStatus: "archived",
          tripUpdatedAt: "2026-01-01T00:00:00Z",
          recordId: "old-note",
          label: "Old response",
          snippet: "Fjord",
          score: 1,
        },
      ]);
    });
    expect(screen.queryByText("Old response")).not.toBeInTheDocument();
  });

  it("drops an old success during the replacement query's debounce", async () => {
    const base = createMockGateway();
    let resolveFirst: ((hits: WorkspaceSearchHit[]) => void) | undefined;
    const searchWorkspace = vi.fn((query: string) => {
      if (query === "Fjord") {
        return new Promise<WorkspaceSearchHit[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return base.searchWorkspace(query);
    });
    renderApp({ ...base, searchWorkspace });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    fireEvent.change(input, { target: { value: "Fjord" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(resolveFirst).toBeDefined());

    fireEvent.change(input, { target: { value: "Maple Lantern" } });
    await act(async () =>
      resolveFirst?.([
        {
          source: "note",
          tripId: "trip_oslo",
          tripTitle: "Archived Oslo notes",
          tripStatus: "archived",
          tripUpdatedAt: "2026-01-01T00:00:00Z",
          recordId: "old-note",
          label: "Old response",
          snippet: "Fjord",
          score: 1,
        },
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.queryByText("Old response")).not.toBeInTheDocument();
    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();
  });

  it("drops an old failure as soon as the traveler starts a replacement query", async () => {
    const base = createMockGateway();
    let rejectFirst: (() => void) | undefined;
    const searchWorkspace = vi.fn((query: string) => {
      if (query === "Fjord") {
        return new Promise<WorkspaceSearchHit[]>((_resolve, reject) => {
          rejectFirst = () =>
            reject({
              code: "transport/failure",
              message: "engine unavailable",
            });
        });
      }
      return base.searchWorkspace(query);
    });
    renderApp({ ...base, searchWorkspace });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    const input = screen.getByLabelText("Search all trips");
    fireEvent.change(input, { target: { value: "Fjord" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(rejectFirst).toBeDefined());

    // The next request is intentionally still inside its debounce. Changing
    // intent must revoke the old action now, not only when that timer fires.
    fireEvent.change(input, { target: { value: "Maple Lantern" } });
    await act(async () => rejectFirst?.());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Offline")).toBeNull();
    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();
  });

  it("finds local records across trips and opens the owning trip", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    await screen.findByRole("heading", { name: "Search workspace" });

    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Maple Lantern" },
    });

    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();
    const result = screen.getByText("Kyoto autumn journey").closest("button")!;
    expect(within(result).getByText("Source document")).toBeInTheDocument();
    expect(within(result).getByText(/Trip updated/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Kyoto confirmations/i }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "document",
      ),
    );
    expect(window.location.href).not.toContain("Maple%20Lantern");
  });

  it("labels archived results and their source kind", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_oslo", "Fjord museum ideas");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Fjord" },
    });

    const result = (await screen.findByText("Archived Oslo notes")).closest(
      "button",
    )!;
    expect(within(result).getAllByText("Trip notes")).toHaveLength(2);
    expect(within(result).getByText("Archived trip")).toBeInTheDocument();
  });

  it("moves focus to the matching traveler-owned record", async () => {
    const gateway = createMockGateway();
    const item = await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Ceramics workshop",
      location: "Gion",
      startAt: "2026-11-05T10:00",
      endAt: "2026-11-05T12:00",
    });
    expect(await gateway.searchWorkspace("2026-11-05T10:00")).toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: item.id })]),
    );
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Ceramics workshop" },
    });
    const result = await screen.findByRole("button", {
      name: /Ceramics workshop.*Kyoto autumn journey/,
    });
    fireEvent.click(result);

    const target = await screen.findByTestId(
      `search-target-trip_item-${item.id}`,
    );
    await waitFor(() => expect(target).toHaveFocus());

    const custom = screen.getByLabelText("Custom item");
    const form = custom.closest("form")!;
    const add = within(form).getByRole("button", { name: "Add" });
    fireEvent.change(custom, { target: { value: "Revalidation marker" } });
    add.focus();
    fireEvent.click(add);
    await screen.findByText("Revalidation marker");
    expect(add).toHaveFocus();
  });

  it("keeps an exact resource handoff alive while its local list is slow", async () => {
    const base = createMockGateway();
    const resource = await base.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/workspace-slow-garden",
      title: "Slow workspace garden",
      note: "Moss photography notes",
      tags: ["garden"],
    });
    let releaseResources: (() => void) | undefined;
    const listResources = vi.fn(
      (tripId: string) =>
        new Promise<Awaited<ReturnType<typeof base.listResources>>>(
          (resolve) => {
            releaseResources = () =>
              void base.listResources(tripId).then(resolve);
          },
        ),
    );
    renderApp({ ...base, listResources });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Slow workspace garden" },
    });
    fireEvent.click(
      (await screen.findByText("Slow workspace garden")).closest("button")!,
    );
    await waitFor(() => expect(releaseResources).toBeDefined());

    // The prior handoff gave up after its one-second retry window. The source
    // is only slow, so the traveler should hear that the exact request remains
    // active and receive focus when the local list finally settles.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(
      screen.getByText(
        "Saved reading is still loading. Voyalier will open this source when it is ready.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "That research resource is no longer available. Saved reading opened.",
      ),
    ).toBeNull();

    await act(async () => releaseResources?.());
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          `[data-search-source="resource"][data-search-record="${resource.id}"]`,
        ),
      ).toHaveFocus(),
    );
  });

  it("keeps an exact notes handoff alive while the local record is slow", async () => {
    const base = createMockGateway();
    await base.setTripNotes("trip_kyoto", "Slow workspace note");
    let releaseNotes: (() => void) | undefined;
    const getTripNotes = vi.fn(
      (tripId: string) =>
        new Promise<Awaited<ReturnType<typeof base.getTripNotes>>>(
          (resolve) => {
            releaseNotes = () => void base.getTripNotes(tripId).then(resolve);
          },
        ),
    );
    renderApp({ ...base, getTripNotes });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Slow workspace note" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Trip notes.*Kyoto autumn journey/,
      }),
    );
    await waitFor(() => expect(releaseNotes).toBeDefined());

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(
      screen.getByText(
        "Trip notes are still loading. Voyalier will open them when they are ready.",
      ),
    ).toBeInTheDocument();

    await act(async () => releaseNotes?.());
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          '[data-search-source="note"][data-search-record="trip_kyoto"]',
        ),
      ).toHaveFocus(),
    );
  });

  it("keeps a notes read failure honest during a workspace handoff", async () => {
    const base = createMockGateway();
    await base.setTripNotes("trip_kyoto", "Broken workspace note");
    renderApp({
      ...base,
      getTripNotes: async () =>
        Promise.reject({
          code: "storage/failure",
          message: "notes unavailable",
        }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Broken workspace note" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Trip notes.*Kyoto autumn journey/,
      }),
    );

    expect(
      await screen.findByText("Local storage is unavailable"),
    ).toHaveAttribute("role", "alert");
    expect(
      screen.queryByText(
        "Trip notes could not be opened. Trip preparation opened.",
      ),
    ).toBeNull();
  });

  it("explains when a saved place disappeared after the workspace search", async () => {
    const base = createMockGateway();
    const removed: WorkspaceSearchHit = {
      source: "saved_place",
      tripId: "trip_kyoto",
      tripTitle: "Kyoto autumn journey",
      tripStatus: "draft",
      tripUpdatedAt: "2026-01-01T00:00:00Z",
      recordId: "removed-workspace-place",
      label: "Removed courtyard",
      snippet: "quiet courtyard",
      score: 1,
    };
    renderApp({ ...base, searchWorkspace: async () => [removed] });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Removed courtyard" },
    });
    fireEvent.click(
      (await screen.findByText("Removed courtyard")).closest("button")!,
    );

    expect(
      await screen.findByText(
        "That saved place is no longer available. Saved places opened.",
        {},
        { timeout: 2_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved places" })).toHaveFocus();
    expect(window.location.href).not.toContain(removed.recordId);
  });

  it("localizes a missing workspace source fallback in Spanish", async () => {
    setLocalePreference("es");
    const base = createMockGateway();
    const removed: WorkspaceSearchHit = {
      source: "saved_place",
      tripId: "trip_kyoto",
      tripTitle: "Kyoto autumn journey",
      tripStatus: "draft",
      tripUpdatedAt: "2026-01-01T00:00:00Z",
      recordId: "removed-spanish-place",
      label: "Patio retirado",
      snippet: "patio tranquilo",
      score: 1,
    };
    renderApp({ ...base, searchWorkspace: async () => [removed] });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Buscar en el espacio de trabajo",
      }),
    );
    fireEvent.change(screen.getByLabelText("Buscar en todos los viajes"), {
      target: { value: "Patio retirado" },
    });
    fireEvent.click(
      (await screen.findByText("Patio retirado")).closest("button")!,
    );

    expect(
      await screen.findByText(
        "Ese lugar guardado ya no está disponible. Se abrieron los lugares guardados.",
        {},
        { timeout: 2_000 },
      ),
    ).toBeInTheDocument();
  });

  it("mounts only the workspace result's deferred section", async () => {
    class NeverIntersectingObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", NeverIntersectingObserver);

    const base = createMockGateway();
    const resource = await base.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/workspace-selective-mount",
      title: "Selective workspace source",
      note: "deferred mount proof",
      tags: ["proof"],
    });
    const detectLocalAi = vi.fn(base.detectLocalAi);
    const listChatMessages = vi.fn(base.listChatMessages);
    renderApp({ ...base, detectLocalAi, listChatMessages });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Selective workspace source" },
    });
    fireEvent.click(
      (await screen.findByText("Selective workspace source")).closest(
        "button",
      )!,
    );

    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          `[data-search-source="resource"][data-search-record="${resource.id}"]`,
        ),
      ).toHaveFocus(),
    );
    expect(detectLocalAi).not.toHaveBeenCalled();
    expect(listChatMessages).not.toHaveBeenCalled();
  });

  /**
   * A search target is transient, but its owning section is durable navigation.
   *
   * Opening a Plan result from Visa used to focus the right record while
   * carrying `#section-visa` into the new URL. The target hid the conflict until
   * reload, when it disappeared and the stale hash moved the traveler back to
   * Visa. Keep the record id and query out of the URL, but make the section
   * truthful enough to survive reload.
   */
  it("writes the owning Plan section when a same-trip result opens", async () => {
    const gateway = createMockGateway();
    const item = await gateway.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Evening walk",
      location: "Gion",
      startAt: "2026-11-05T18:00",
      endAt: "2026-11-05T19:00",
    });
    const first = renderApp(gateway);
    await openFixtureTrip();
    window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Evening walk" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Evening walk.*Kyoto autumn journey/,
      }),
    );

    const target = await screen.findByTestId(
      `search-target-trip_item-${item.id}`,
    );
    await waitFor(() => expect(target).toHaveFocus());
    expect(window.location.search).toBe("?trip=trip_kyoto");
    expect(window.location.hash).toBe("#section-plan");
    expect(window.location.href).not.toContain(item.id);
    expect(window.location.href).not.toContain("Evening%20walk");

    // A reload rebuilds the view from the URL without a transient target. The
    // URL must therefore retain the truthful section on its own.
    first.unmount();
    renderApp(gateway);
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    expect(window.location.hash).toBe("#section-plan");
  });

  it("writes Prepare when a result opens a different trip's note", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_oslo", "Fjord museum ideas");
    renderApp(gateway);
    await openFixtureTrip();
    window.history.replaceState(null, "", "/?trip=trip_kyoto#section-visa");

    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "Fjord museum" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Archived Oslo notes.*Trip notes/,
      }),
    );

    await screen.findByRole("heading", {
      name: "Archived Oslo notes",
      level: 1,
    });
    await waitFor(() => expect(window.location.search).toBe("?trip=trip_oslo"));
    expect(window.location.hash).toBe("#section-prepare");
  });

  it("localizes product-owned result labels while preserving source text", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Museo del papel");
    await gateway.downloadPack("trip_kyoto", "jp-kyoto");
    const weights = {
      food: 1,
      culture: 0.5,
      nature: 0.5,
      nightlife: 0.5,
      shopping: 0.5,
    };
    const recommendation = (
      await gateway.getRecommendations("trip_kyoto", weights)
    )[0];
    await gateway.savePlace({
      tripId: "trip_kyoto",
      recommendation,
      weights,
    });
    setLocalePreference("es");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Buscar en el espacio de trabajo",
      }),
    );
    fireEvent.change(screen.getByLabelText("Buscar en todos los viajes"), {
      target: { value: "Museo" },
    });

    const result = (await screen.findByText("Kyoto autumn journey")).closest(
      "button",
    )!;
    expect(within(result).getAllByText("Notas del viaje")).toHaveLength(2);
    expect(within(result).queryByText("Trip notes")).not.toBeInTheDocument();
    expect(result.textContent).not.toContain("Trip notes");
    expect(
      (await gateway.searchWorkspace("Trip notes")).filter(
        (hit) => hit.source === "note",
      ),
    ).toHaveLength(0);
    expect(await gateway.searchWorkspace("propertyName")).toHaveLength(0);
    expect(await gateway.searchWorkspace("confirmationCode")).toHaveLength(0);
    expect(await gateway.searchWorkspace("Matches your interest")).toHaveLength(
      0,
    );
  });

  // The audit's gap #11: every flight and stay result was headed "Confirmed
  // fact", spending its one line on the word the interface already prints
  // beside it instead of naming which fact matched.
  it("names a confirmed-fact result with the traveler's own data", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "FP18" },
    });

    // The headline names the fact; the raw matched text stays underneath as
    // the evidence for why it matched.
    const heading = await screen.findByText("ORD → HND");
    expect(heading.tagName).toBe("STRONG");
    const result = heading.closest("button")!;
    // The source kind is still stated, just no longer as the headline.
    expect(result.textContent).toContain("Confirmed fact");

    // The gateway carries identifying data, never a product noun.
    const hits = await gateway.searchWorkspace("FP18");
    const fact = hits.find((hit) => hit.source === "confirmed_fact")!;
    expect(fact.label).not.toBe("Confirmed fact");
    expect(fact.label).toBe("ORD → HND");
  });
});

/**
 * Every other top-level view — the trip list, a trip, Settings, the vault
 * unlock — hand-rolls its own `h1`. This one used `SectionTitle`, which renders
 * an `h2` because it titles sections inside a page, so the search view was the
 * only destination in the app with no top-level heading at all.
 *
 * Asserted on the level directly rather than through axe: `findA11yViolations`
 * runs axe against `document.body`, and axe skips page-level rules such as
 * `page-has-heading-one` when the context is not the whole document — so an
 * accessibility sweep would have gone on passing either way.
 */
describe("workspace search heading", () => {
  it("titles itself with the page's h1", async () => {
    renderApp(createMockGateway());
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));

    expect(
      await screen.findByRole("heading", {
        name: "Search workspace",
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it("offers a way forward when nothing matches", async () => {
    renderApp(createMockGateway());
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    fireEvent.change(await screen.findByLabelText("Search all trips"), {
      target: { value: "zzzznotathing" },
    });

    expect(
      await screen.findByText("No matches in this workspace."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Search covers imported documents/),
    ).toBeInTheDocument();
  });
});
