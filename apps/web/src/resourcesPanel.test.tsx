import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Saved reading lives in a deferred section, so it mounts a beat after the trip
 * page and then loads its list and the standing fetch permission together.
 */
async function openResources(gateway?: AppGateway) {
  renderApp(gateway ?? createMockGateway());
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Saved reading" });
}

/** Fill the quick-add form and submit it. */
function saveLink(
  region: HTMLElement,
  url: string,
  fields: { title?: string; tags?: string } = {},
) {
  fireEvent.change(within(region).getByLabelText("Link address"), {
    target: { value: url },
  });
  if (fields.title !== undefined) {
    fireEvent.change(within(region).getByLabelText("Title (optional)"), {
      target: { value: fields.title },
    });
  }
  if (fields.tags !== undefined) {
    fireEvent.change(within(region).getByLabelText("Tags (optional)"), {
      target: { value: fields.tags },
    });
  }
  fireEvent.click(within(region).getByRole("button", { name: "Save" }));
}

/** The list of saved rows, which only exists once something is saved. */
function rows(region: HTMLElement) {
  return within(
    within(region).getByRole("list", { name: "Saved reading" }),
  ).getAllByRole("listitem");
}

/**
 * Trip-scoped research: the links a traveler keeps because they mean to read
 * them. Reading material, never evidence — and the one control that can reach
 * the network stays behind a permission the traveler grants and can withdraw.
 */
describe("saved reading", () => {
  it("saves a pasted link and lists it", async () => {
    const gateway = createMockGateway();
    const region = await openResources(gateway);

    saveLink(region, "https://example.com/kyoto-guide", {
      title: "Kyoto guide",
    });

    expect(
      await within(region).findByRole("link", { name: /Kyoto guide/ }),
    ).toHaveAttribute("href", "https://example.com/kyoto-guide");
    const stored = await gateway.listResources("trip_kyoto");
    expect(stored).toHaveLength(1);
  });

  it("says a link is already saved instead of showing it twice", async () => {
    const gateway = createMockGateway();
    const region = await openResources(gateway);

    saveLink(region, "https://example.com/kyoto-guide", {
      title: "Kyoto guide",
    });
    await within(region).findByRole("link", { name: /Kyoto guide/ });

    // The store folds a repeat save back onto the original and returns it. The
    // interface must not read that as a new row — the traveler has one link.
    saveLink(region, "https://example.com/kyoto-guide");

    expect(
      await within(region).findByText(/You already saved that link/),
    ).toBeInTheDocument();
    await waitFor(() => expect(rows(region)).toHaveLength(1));
    expect(await gateway.listResources("trip_kyoto")).toHaveLength(1);
  });

  it("offers no fetch until fetching is allowed, then stores and shows a snapshot", async () => {
    const gateway = createMockGateway();
    const region = await openResources(gateway);

    saveLink(region, "https://example.com/kyoto-guide", {
      title: "Kyoto guide",
    });
    await within(region).findByRole("link", { name: /Kyoto guide/ });

    // Fetching is the only thing on this panel that touches the network, so it
    // is absent — not merely disabled — until it has been allowed, and the row
    // says why rather than offering a button that would refuse.
    expect(
      within(region).queryByRole("button", { name: /Fetch page details/ }),
    ).toBeNull();
    expect(
      within(region).getByText(/Turn on .Allow fetching page details./),
    ).toBeInTheDocument();

    fireEvent.click(
      within(region).getByLabelText("Allow fetching page details"),
    );

    const fetchButton = await within(region).findByRole("button", {
      name: "Fetch page details for Kyoto guide",
    });
    fireEvent.click(fetchButton);

    // The snapshot is kept, dated, and readable in place.
    fireEvent.click(
      await within(region).findByRole("button", { name: "Read here" }),
    );
    expect(
      await within(region).findByText(
        /Readable text captured from https:\/\/example.com\/kyoto-guide/,
      ),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: /Open the original/ }),
    ).toBeInTheDocument();

    const [stored] = await gateway.listResources("trip_kyoto");
    expect(stored.snapshot?.contentHash).toBeTruthy();
  });

  it("is reversible: fetching can be turned back off", async () => {
    const gateway = createMockGateway();
    const region = await openResources(gateway);
    saveLink(region, "https://example.com/kyoto-guide", {
      title: "Kyoto guide",
    });
    await within(region).findByRole("link", { name: /Kyoto guide/ });

    const toggle = within(region).getByLabelText(
      "Allow fetching page details",
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(within(region).getByText(/Fetching is allowed/)).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(
      within(region).queryByRole("button", { name: /Fetch page details/ }),
    ).toBeNull();
    expect((await gateway.getResearchSettings()).autoFetchDetails).toBe(false);
  });

  it("filters by tag and clears back to all", async () => {
    const region = await openResources();

    saveLink(region, "https://example.com/temples", {
      title: "Temple walk",
      tags: "temples, autumn",
    });
    await within(region).findByRole("link", { name: /Temple walk/ });
    saveLink(region, "https://example.com/food", {
      title: "Food notes",
      tags: "food",
    });
    await within(region).findByRole("link", { name: /Food notes/ });

    const filter = within(region).getByRole("list", {
      name: "Filter saved reading by tag",
    });
    fireEvent.click(within(filter).getByRole("button", { name: "food" }));

    await waitFor(() =>
      expect(
        within(region).queryByRole("link", { name: /Temple walk/ }),
      ).toBeNull(),
    );
    expect(
      within(region).getByRole("link", { name: /Food notes/ }),
    ).toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "All" }));
    expect(
      await within(region).findByRole("link", { name: /Temple walk/ }),
    ).toBeInTheDocument();
  });

  it("maps a tag validation response back to Tags and clears it on edit", async () => {
    const base = createMockGateway();
    const region = await openResources({
      ...base,
      createResource: () =>
        Promise.reject({
          code: "validation/invalid_input",
          message: "each tag must be at most 40 characters",
          details: { field: "tags" },
        }),
    });
    const tags = within(region).getByLabelText("Tags (optional)");

    saveLink(region, "https://example.com/kyoto-guide", {
      tags: "a-tag-that-is-deliberately-longer-than-forty-characters",
    });

    const alert = await within(region).findByRole("alert");
    expect(alert).toHaveTextContent(/up to 12 tags/i);
    expect(alert).toHaveTextContent(/40 characters/i);
    expect(tags).toHaveAttribute("aria-invalid", "true");
    expect(tags.getAttribute("aria-describedby")).toContain(alert.id);
    expect(tags).toHaveFocus();
    expect(
      within(region).queryByText("Check the highlighted fields"),
    ).toBeNull();

    fireEvent.change(tags, { target: { value: "planning" } });
    expect(within(region).queryByRole("alert")).toBeNull();
    expect(tags).not.toHaveAttribute("aria-invalid");
  });

  it("edits a saved link and removes it", async () => {
    const gateway = createMockGateway();
    const region = await openResources(gateway);
    saveLink(region, "https://example.com/kyoto-guide", {
      title: "Kyoto guide",
    });
    await within(region).findByRole("link", { name: /Kyoto guide/ });

    fireEvent.click(
      within(region).getByRole("button", { name: "Edit Kyoto guide" }),
    );
    const [row] = rows(region);
    fireEvent.change(within(row).getByLabelText("Title (optional)"), {
      target: { value: "Kyoto reading" },
    });
    fireEvent.change(within(row).getByLabelText("Your note (optional)"), {
      target: { value: "Start with the north-east loop" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save changes" }));

    // Wait for the row to leave edit mode before reading it back — the open
    // textarea still holds the same words, and matching it would pass whether
    // or not the write ever landed.
    await within(region).findByRole("button", { name: "Edit Kyoto reading" });
    expect(
      within(region).getByText("Start with the north-east loop"),
    ).toBeInTheDocument();

    // Two-step confirm, like every other irreversible removal here.
    const remove = within(region).getByRole("button", {
      name: "Remove Kyoto reading",
    });
    fireEvent.click(remove);
    fireEvent.click(
      within(region).getByRole("button", { name: /Remove Kyoto reading/ }),
    );

    await waitFor(async () =>
      expect(await gateway.listResources("trip_kyoto")).toHaveLength(0),
    );
  });

  it("says a saved page is reading material and never evidence", async () => {
    const region = await openResources();

    // The whole category boundary, on screen: it is the reason this panel can
    // exist next to an evidence-backed itinerary without muddying it.
    const guidance = within(region).getByText(
      /never turns it into a confirmed booking/,
    );
    expect(guidance).toHaveTextContent(/never changes your trip's readiness/);

    // Pointed at the flow that does read bookings, rather than letting someone
    // paste a confirmation in here and wonder why nothing happened.
    expect(
      within(region).getByText(/Looks like a confirmation\? Import it instead/),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/it contacts the site you saved/),
    ).toBeInTheDocument();
  });

  it("lets the guidance be dismissed without hiding the panel", async () => {
    const region = await openResources();
    const guidance = within(region).getByText(
      /never turns it into a confirmed booking/,
    );

    fireEvent.click(
      within(guidance).getByRole("button", { name: "Dismiss tip" }),
    );

    expect(
      within(region).queryByText(/never turns it into a confirmed booking/),
    ).toBeNull();
    expect(within(region).getByLabelText("Link address")).toBeInTheDocument();
  });
});
