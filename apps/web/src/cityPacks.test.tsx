import { fireEvent, screen, within } from "@testing-library/react";
import type { AppGateway, PackSuggestion } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openPacks(tripButton = "Open Kyoto autumn journey") {
  fireEvent.click(await screen.findByRole("button", { name: tripButton }));
  await screen.findByRole("heading", { level: 1 });
  return screen.findByRole("region", { name: "Offline city data" });
}

/**
 * The city-pack catalog is lazy (nothing read until asked) and shows the
 * required seed cities with their per-layer licenses.
 */
describe("City packs", () => {
  it("does not read the catalog until asked", async () => {
    let calls = 0;
    const base = createMockGateway();
    const gateway = {
      ...base,
      listPacks: () => {
        calls += 1;
        return base.listPacks();
      },
    };
    renderApp(gateway);

    const region = await openPacks();
    expect(calls).toBe(0);

    fireEvent.click(
      within(region).getByRole("button", { name: "Browse city packs" }),
    );
    expect(await within(region).findByText("Nashville")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("lists the Hawaii island packs with their layer licenses", async () => {
    renderApp(createMockGateway());
    const region = await openPacks();

    fireEvent.click(
      within(region).getByRole("button", { name: "Browse city packs" }),
    );

    // Hawaii ships as separate island packs.
    expect(await within(region).findByText("Maui")).toBeInTheDocument();
    expect(within(region).getByText("Kauaʻi")).toBeInTheDocument();

    // Each pack credits its two layers under their own licenses.
    const maui = within(region).getByText("Maui").closest("li")!;
    const layers = within(maui).getByRole("list", {
      name: "Maui data layers",
    });
    expect(within(layers).getByText(/Overture Maps/)).toBeInTheDocument();
    expect(within(layers).getByText(/CC-BY-SA-3\.0/)).toBeInTheDocument();
  });

  it("downloads a pack for the trip and then offers to remove it", async () => {
    renderApp(createMockGateway());
    const region = await openPacks();

    fireEvent.click(
      within(region).getByRole("button", { name: "Browse city packs" }),
    );

    const nashville = (await within(region).findByText("Nashville")).closest(
      "li",
    )!;
    fireEvent.click(
      within(nashville).getByRole("button", { name: "Download for this trip" }),
    );

    // Once downloaded, the row shows offline counts and a remove control.
    expect(await within(nashville).findByText(/offline/)).toBeInTheDocument();
    const remove = within(nashville).getByRole("button", { name: "Remove" });
    fireEvent.click(remove);

    // Removing restores the download affordance.
    expect(
      await within(nashville).findByRole("button", {
        name: "Download for this trip",
      }),
    ).toBeInTheDocument();
  });
});

/**
 * "Recommended for this trip" is a local, zero-network match of the trip's
 * destination against the catalog. It surfaces the best pack near the top,
 * supports the no-match and ambiguous states, and keeps the click-to-download
 * consent wording intact.
 */
describe("City pack suggestions", () => {
  it("recommends the destination's pack and downloads it on click", async () => {
    // The Kyoto fixture trip resolves to the jp-kyoto pack.
    renderApp(createMockGateway());
    const region = await openPacks();

    const suggested = await within(region).findByText(
      "Recommended for this trip",
    );
    const block = suggested.closest("div")!;
    const download = within(block).getByRole("button", {
      name: "Download Kyoto city data",
    });
    // The consent wording is present: pull in, nothing about the trip sent.
    expect(
      within(block).getByText(
        /nothing about your trip is sent except the request for the pack file/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(download);
    expect(await within(block).findByText(/offline/)).toBeInTheDocument();
  });

  it("shows a no-match line when nothing in the catalog matches", async () => {
    // The Lisbon fixture trip has no matching pack.
    renderApp(createMockGateway());
    const region = await openPacks("Open Lisbon spring draft");
    expect(
      await within(region).findByText(/No city pack matches “Lisbon” yet/),
    ).toBeInTheDocument();
    expect(within(region).queryByText("Recommended for this trip")).toBeNull();
  });

  it("supports an ambiguous match with more than one option", async () => {
    const base = createMockGateway();
    const twoMatches: PackSuggestion[] = [
      {
        pack: {
          id: "jp-kyoto",
          name: "Kyoto",
          region: "Japan",
          bbox: { west: 135.68, south: 34.93, east: 135.83, north: 35.1 },
          wikivoyageArticle: "Kyoto",
          layers: [],
        },
        matchKind: "partial",
        matchedText: "Japan",
      },
      {
        pack: {
          id: "jp-tokyo",
          name: "Tokyo",
          region: "Japan",
          bbox: { west: 139.56, south: 35.53, east: 139.92, north: 35.82 },
          wikivoyageArticle: "Tokyo",
          layers: [],
        },
        matchKind: "partial",
        matchedText: "Japan",
      },
    ];
    const gateway: AppGateway = {
      ...base,
      suggestPacks: () => Promise.resolve(twoMatches),
    };
    renderApp(gateway);
    const region = await openPacks();

    const suggested = await within(region).findByText(
      "Recommended for this trip",
    );
    const block = suggested.closest("div")!;
    expect(
      within(block).getByText(/More than one pack could match/),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: "Download Kyoto city data" }),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: "Download Tokyo city data" }),
    ).toBeInTheDocument();
  });
});
