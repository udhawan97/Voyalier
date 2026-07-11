import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openPacks() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
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
