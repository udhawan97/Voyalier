import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

async function openSearch() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  return screen.findByRole("region", { name: "Find in this trip" });
}

function searchInput(region: HTMLElement) {
  return within(region).getByLabelText(
    "Search your documents and confirmed plans",
  );
}

/**
 * "Find in this trip" is relaxed, as-you-type local search over stored documents
 * and confirmed facts: any word matches (partial too), matching terms are
 * offered as autofill suggestions, and results can be copied to reuse.
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
    renderApp(createMockGateway());
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
        "Busca en tus documentos y planes confirmados",
      ),
      { target: { value: "FP18" } },
    );
    expect(await within(search).findByText("Vuelo FP18")).toBeInTheDocument();
    expect(within(search).queryByText("Flight FP18")).toBeNull();
  });
});
