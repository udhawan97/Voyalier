import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { failingGateway, rejectWith, renderApp } from "./test/helpers";

async function openSearch() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  return screen.findByRole("region", { name: "Find in this trip" });
}

function searchInput(region: HTMLElement) {
  return within(region).getByLabelText(
    "Search documents, confirmed plans, and saved research",
  );
}

/**
 * "Find in this trip" is relaxed, as-you-type local search over stored documents,
 * confirmed facts, and saved research: any word matches (partial too), matching
 * terms are offered as autofill suggestions, and results can return to their
 * local source or be copied to reuse.
 */
describe("trip search", () => {
  afterEach(() => setLocalePreference("en"));

  it("searches live as you type and labels provenance", async () => {
    renderApp(createMockGateway());
    const search = await openSearch();

    fireEvent.change(searchInput(search), { target: { value: "paper" } });

    const results = await within(search).findByRole("list", {
      name: "Search results",
    });
    expect(
      within(results).getAllByText("River Paper Inn").length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(results).getByText(/confirmed plan/)).toBeInTheDocument();
  });

  it("names saved research without presenting it as a confirmed stay", async () => {
    const gateway = createMockGateway();
    await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/kyoto-etiquette",
      title: "Kyoto etiquette notes",
      note: "Temple photography guidance",
      tags: ["etiquette"],
    });
    renderApp(gateway);
    const search = await openSearch();

    fireEvent.change(searchInput(search), {
      target: { value: "photography" },
    });

    const results = await within(search).findByRole("list", {
      name: "Search results",
    });
    const result = within(results)
      .getByText("Kyoto etiquette notes")
      .closest("li")!;
    expect(within(result).getByText(/research resource/)).toBeInTheDocument();
    expect(within(result).queryByText("confirmed plan")).toBeNull();
    expect(within(result).queryByText("Stay")).toBeNull();
    expect(within(result).getByText(/photography guidance/i)).toBeVisible();
  });

  it("matches partial words and reports a plain empty state", async () => {
    renderApp(createMockGateway());
    const search = await openSearch();
    const input = searchInput(search);

    // Partial word "riv" relaxes to "River Paper Inn".
    fireEvent.change(input, { target: { value: "riv" } });
    await within(search).findByRole("list", { name: "Search results" });
    expect(
      within(search).getAllByText("River Paper Inn").length,
    ).toBeGreaterThanOrEqual(1);

    // A no-match query reports plainly (no error, no dead end).
    fireEvent.change(input, { target: { value: "zeppelin" } });
    await waitFor(() =>
      expect(
        within(search).getByText(/No matches for “zeppelin”/),
      ).toBeInTheDocument(),
    );
  });

  it("says the search failed instead of claiming the trip has no matches", async () => {
    renderApp(
      failingGateway({
        searchTrip: rejectWith({
          code: "transport/failure",
          message: "engine unreachable",
        }),
      }),
    );
    const search = await openSearch();

    fireEvent.change(searchInput(search), { target: { value: "paper" } });

    // A failed search must be stated as a failure. Reporting "no matches" would
    // tell the traveler their own documents don't contain something they do.
    expect(await within(search).findByRole("alert")).toHaveTextContent(
      "Voyalier can't reach its engine",
    );
    expect(within(search).queryByText(/No matches for/)).toBeNull();
  });

  it("keeps suggestions best-effort when only the typeahead fails", async () => {
    renderApp(
      failingGateway({
        suggestSearchTerms: rejectWith({
          code: "transport/failure",
          message: "engine unreachable",
        }),
      }),
    );
    const search = await openSearch();

    fireEvent.change(searchInput(search), { target: { value: "paper" } });

    // The results are the substance; losing the autofill chips is not a failure
    // worth interrupting the search with.
    await within(search).findByRole("list", { name: "Search results" });
    expect(within(search).queryByRole("alert")).toBeNull();
  });

  it("offers a suggestion that autofills the search", async () => {
    renderApp(createMockGateway());
    const search = await openSearch();
    const input = searchInput(search);

    // "riv" surfaces "River Paper Inn" as a clickable suggestion.
    fireEvent.change(input, { target: { value: "riv" } });
    const suggestions = await within(search).findByRole("list", {
      name: "Search suggestions",
    });
    const chip = within(suggestions).getByRole("button", {
      name: "River Paper Inn",
    });
    fireEvent.click(chip);

    // The box is autofilled with the chosen term.
    expect(input).toHaveValue("River Paper Inn");
  });

  it("copies a result's value to reuse it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderApp(createMockGateway());
    const search = await openSearch();
    fireEvent.change(searchInput(search), { target: { value: "paper" } });

    const results = await within(search).findByRole("list", {
      name: "Search results",
    });
    const firstHit = within(results).getAllByRole("listitem")[0];
    fireEvent.click(within(firstHit).getByRole("button", { name: /Copy/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("River Paper Inn");
    expect(await within(firstHit).findByText("Copied")).toBeInTheDocument();
  });

  it("returns a confirmed-plan result to its exact Blueprint record", async () => {
    const gateway = createMockGateway();
    const hit = (await gateway.searchTrip("trip_kyoto", "FP18")).find(
      (candidate) => candidate.source === "confirmed_fact",
    )!;
    renderApp(gateway);
    const search = await openSearch();
    fireEvent.change(searchInput(search), { target: { value: "FP18" } });

    const result = (await within(search).findByText("Flight FP18")).closest(
      "li",
    )!;
    fireEvent.click(
      within(result).getByRole("button", {
        name: "Show source: Flight FP18",
      }),
    );

    const target = document.querySelector<HTMLElement>(
      `[data-search-source="confirmed_fact"][data-search-record="${hit.recordId}"]`,
    )!;
    await waitFor(() => expect(target).toHaveFocus());
    expect(window.location.href).not.toContain(hit.recordId);
    expect(window.location.href).not.toContain("FP18");
    expect(searchInput(search)).toHaveValue("FP18");
  });

  it("returns an imported-document result without reading its sealed body", async () => {
    const base = createMockGateway();
    const hit = (await base.searchTrip("trip_kyoto", "Maple Lantern")).find(
      (candidate) => candidate.source === "document",
    )!;
    const getDocument = vi.fn(base.getDocument);
    renderApp({ ...base, getDocument });
    const search = await openSearch();
    fireEvent.change(searchInput(search), {
      target: { value: "Maple Lantern" },
    });

    const result = (await within(search).findByText(hit.label)).closest("li")!;
    fireEvent.click(
      within(result).getByRole("button", {
        name: `Show source: ${hit.label}`,
      }),
    );

    const target = document.querySelector<HTMLElement>(
      `[data-search-source="document"][data-search-record="${hit.recordId}"]`,
    )!;
    await waitFor(() => expect(target).toHaveFocus());
    expect(getDocument).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(hit.recordId);
    expect(searchInput(search)).toHaveValue("Maple Lantern");
  });

  it("returns a research result without fetching the saved page", async () => {
    const base = createMockGateway();
    const resource = await base.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/quiet-gardens",
      title: "Quiet garden notes",
      note: "Moss garden photography",
      tags: ["garden"],
    });
    const fetchResourceDetails = vi.fn(base.fetchResourceDetails);
    renderApp({ ...base, fetchResourceDetails });
    const search = await openSearch();
    fireEvent.change(searchInput(search), { target: { value: "moss" } });

    const result = (await within(search).findByText(resource.title)).closest(
      "li",
    )!;
    fireEvent.click(
      within(result).getByRole("button", {
        name: `Show source: ${resource.title}`,
      }),
    );

    const target = document.querySelector<HTMLElement>(
      `[data-search-source="resource"][data-search-record="${resource.id}"]`,
    )!;
    await waitFor(() => expect(target).toHaveFocus());
    expect(fetchResourceDetails).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(resource.id);
    expect(searchInput(search)).toHaveValue("moss");
  });

  it("reveals a research result hidden by an active tag filter", async () => {
    const gateway = createMockGateway();
    const hidden = await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/hidden-garden",
      title: "Hidden garden notes",
      note: "Moss garden photography",
      tags: ["garden"],
    });
    await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/noodle-notes",
      title: "Noodle notes",
      note: "Dinner shortlist",
      tags: ["food"],
    });
    renderApp(gateway);
    const search = await openSearch();
    const resources = await screen.findByRole("region", {
      name: "Saved reading",
    });
    const filters = await within(resources).findByRole("list", {
      name: "Filter saved reading by tag",
    });
    fireEvent.click(within(filters).getByRole("button", { name: "food" }));
    expect(
      within(resources).queryByRole("link", { name: /Hidden garden notes/ }),
    ).toBeNull();

    fireEvent.change(searchInput(search), { target: { value: "moss" } });
    const result = (
      await within(search).findByText("Hidden garden notes")
    ).closest("li")!;
    fireEvent.click(
      within(result).getByRole("button", {
        name: "Show source: Hidden garden notes",
      }),
    );

    await waitFor(
      () =>
        expect(
          document.querySelector<HTMLElement>(
            `[data-search-source="resource"][data-search-record="${hidden.id}"]`,
          ),
        ).toHaveFocus(),
      { timeout: 2_000 },
    );
    expect(
      screen.queryByText(
        "That research resource is no longer available. Saved reading opened.",
      ),
    ).toBeNull();
    expect(
      within(filters).getByRole("button", { name: "All" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps waiting and explains when a saved-reading list is unusually slow", async () => {
    const base = createMockGateway();
    const resource = await base.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/slow-garden",
      title: "Slow garden notes",
      note: "Moss garden photography",
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
    const search = await openSearch();
    await waitFor(() => expect(releaseResources).toBeDefined());
    fireEvent.change(searchInput(search), { target: { value: "slow moss" } });
    const result = (
      await within(search).findByText("Slow garden notes")
    ).closest("li")!;
    fireEvent.click(
      within(result).getByRole("button", {
        name: "Show source: Slow garden notes",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10_100));
    expect(
      screen.queryByText(
        "That research resource is no longer available. Saved reading opened.",
      ),
    ).toBeNull();
    expect(
      screen.getByText(
        "Saved reading is still loading. Voyalier will open this source when it is ready.",
      ),
    ).toBeInTheDocument();
    await act(async () => releaseResources?.());
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          `[data-search-source="resource"][data-search-record="${resource.id}"]`,
        ),
      ).toHaveFocus(),
    );
  });

  it("opens document and research rows without mounting unrelated deferred work", async () => {
    class PrepareOnlyIntersectionObserver {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element): void {
        if ((target as HTMLElement).id === "section-prepare") {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
      }

      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", PrepareOnlyIntersectionObserver);

    const base = createMockGateway();
    const resource = await base.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/quiet-gardens",
      title: "Quiet garden notes",
      note: "Moss garden photography",
      tags: ["garden"],
    });
    const detectLocalAi = vi.fn(base.detectLocalAi);
    const listChatMessages = vi.fn(base.listChatMessages);
    renderApp({ ...base, detectLocalAi, listChatMessages });
    const search = await openSearch();

    fireEvent.change(searchInput(search), {
      target: { value: "Maple Lantern" },
    });
    const documentResult = (
      await within(search).findByText("Kyoto confirmations")
    ).closest("li")!;
    fireEvent.click(
      within(documentResult).getByRole("button", {
        name: "Show source: Kyoto confirmations",
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "document",
      ),
    );
    expect(detectLocalAi).not.toHaveBeenCalled();
    expect(listChatMessages).not.toHaveBeenCalled();

    fireEvent.change(searchInput(search), { target: { value: "moss" } });
    const resourceResult = (
      await within(search).findByText(resource.title)
    ).closest("li")!;
    fireEvent.click(
      within(resourceResult).getByRole("button", {
        name: `Show source: ${resource.title}`,
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-search-source",
        "resource",
      ),
    );
    expect(detectLocalAi).not.toHaveBeenCalled();
    expect(listChatMessages).not.toHaveBeenCalled();
    expect(screen.queryByText("Ask this trip")).toBeNull();
  });

  it("falls back honestly when a research result disappears", async () => {
    const base = createMockGateway();
    renderApp({
      ...base,
      searchTrip: async () => [
        {
          source: "resource" as const,
          recordId: "resource_removed_after_search",
          label: "Removed research",
          snippet: "removed research",
          score: 1,
        },
      ],
      suggestSearchTerms: async () => [],
    });
    const search = await openSearch();
    fireEvent.change(searchInput(search), { target: { value: "removed" } });
    const result = (
      await within(search).findByText("Removed research")
    ).closest("li")!;

    fireEvent.click(
      within(result).getByRole("button", {
        name: "Show source: Removed research",
      }),
    );

    const fallback = screen.getByRole("heading", { name: "Saved reading" });
    await waitFor(() => expect(fallback).toHaveFocus(), { timeout: 2_000 });
    expect(
      await screen.findByText(
        "That research resource is no longer available. Saved reading opened.",
      ),
    ).toBeInTheDocument();
    expect(window.location.href).not.toContain("resource_removed_after_search");
  });

  it("does not resurrect results after the box is cleared (stale-response guard)", async () => {
    let releaseSearch: (() => void) | undefined;
    const base = createMockGateway();
    const gateway = {
      ...base,
      // Hold the first search open until we release it, so we can clear the box
      // mid-flight and prove the stale result is discarded.
      searchTrip: (tripId: string, query: string) =>
        new Promise<Awaited<ReturnType<typeof base.searchTrip>>>((resolve) => {
          releaseSearch = () => resolve(base.searchTrip(tripId, query));
        }),
      suggestSearchTerms: () => Promise.resolve([] as string[]),
    };
    renderApp(gateway);
    const search = await openSearch();
    const input = searchInput(search);

    // Type a valid query; wait until the (held) request has actually started.
    fireEvent.change(input, { target: { value: "paper" } });
    await waitFor(() => expect(releaseSearch).toBeDefined());

    // Clear to a too-short query before the first request resolves.
    fireEvent.change(input, { target: { value: "h" } });
    await new Promise((resolve) => setTimeout(resolve, 260));

    // The stale "paper" request now lands — it must be ignored.
    releaseSearch?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      within(search).queryByRole("list", { name: "Search results" }),
    ).toBeNull();
  });

  it("drops an old success before the replacement query starts, even if that query fails", async () => {
    const base = createMockGateway();
    let releaseFirst: (() => void) | undefined;
    const searchTrip = vi.fn((tripId: string, query: string) => {
      if (query === "paper") {
        return new Promise<Awaited<ReturnType<typeof base.searchTrip>>>(
          (resolve) => {
            releaseFirst = () =>
              void base.searchTrip(tripId, query).then(resolve);
          },
        );
      }
      if (query === "zeppelin") {
        return Promise.reject({
          code: "transport/failure",
          message: "engine unreachable",
        });
      }
      return base.searchTrip(tripId, query);
    });
    renderApp({ ...base, searchTrip });
    const search = await openSearch();
    const input = searchInput(search);
    fireEvent.change(input, { target: { value: "paper" } });
    await waitFor(() => expect(releaseFirst).toBeDefined());

    fireEvent.change(input, { target: { value: "zeppelin" } });
    await act(async () => releaseFirst?.());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(within(search).queryByText("River Paper Inn")).toBeNull();
    expect(
      within(search).queryByRole("list", { name: "Search results" }),
    ).toBeNull();

    expect(await within(search).findByRole("alert")).toHaveTextContent(
      "Voyalier can't reach its engine",
    );
    expect(within(search).queryByText("River Paper Inn")).toBeNull();
  });

  it("drops an old failure before the replacement query starts", async () => {
    const base = createMockGateway();
    let rejectFirst: (() => void) | undefined;
    const searchTrip = vi.fn((tripId: string, query: string) => {
      if (query === "paper") {
        return new Promise<Awaited<ReturnType<typeof base.searchTrip>>>(
          (_resolve, reject) => {
            rejectFirst = () =>
              reject({
                code: "transport/failure",
                message: "engine unreachable",
              });
          },
        );
      }
      return base.searchTrip(tripId, query);
    });
    renderApp({ ...base, searchTrip });
    const search = await openSearch();
    const input = searchInput(search);
    fireEvent.change(input, { target: { value: "paper" } });
    await waitFor(() => expect(rejectFirst).toBeDefined());

    fireEvent.change(input, { target: { value: "FP18" } });
    await act(async () => rejectFirst?.());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(within(search).queryByRole("alert")).toBeNull();
    expect(await within(search).findByText("Flight FP18")).toBeInTheDocument();
  });

  it("finds imported document content, matching any word (relaxed)", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    await gateway.importDocument({
      tripId: trip.id,
      kind: "pasted_text",
      label: "Hotel email",
      content: "The airport shuttle leaves every 30 minutes from door 4.",
    });

    // Multi-word query matches on ANY word (relaxed), not just an exact phrase.
    const hits = await gateway.searchTrip(trip.id, "airport monorail");
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe("document");
    expect(hits[0].snippet).toContain("airport");

    // Typeahead completes a partial word from the document.
    const terms = await gateway.suggestSearchTerms(trip.id, "shut");
    expect(terms.some((term) => term.toLowerCase() === "shuttle")).toBe(true);
  });

  it("localizes fact labels while preserving their source subject", async () => {
    setLocalePreference("es");
    const gateway = createMockGateway();
    await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.test/ceramica",
      title: "Notas de cerámica",
      note: "Taller de cerámica local",
      tags: ["cerámica"],
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir Kyoto autumn journey",
      }),
    );
    const search = await screen.findByRole("region", {
      name: "Buscar en este viaje",
    });
    fireEvent.change(
      within(search).getByLabelText(
        "Busca en documentos, planes confirmados e investigación guardada",
      ),
      { target: { value: "FP18" } },
    );
    expect(await within(search).findByText("Vuelo FP18")).toBeInTheDocument();
    expect(within(search).queryByText("Flight FP18")).toBeNull();

    fireEvent.change(
      within(search).getByLabelText(
        "Busca en documentos, planes confirmados e investigación guardada",
      ),
      { target: { value: "cerámica" } },
    );
    const resource = (
      await within(search).findByText("Notas de cerámica")
    ).closest("li")!;
    expect(
      within(resource).getByText(/recurso de investigación/),
    ).toBeVisible();
    expect(
      within(resource).getByRole("button", {
        name: "Mostrar fuente: Notas de cerámica",
      }),
    ).toBeVisible();
  });
});
