import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { findA11yViolations, renderApp } from "./test/helpers";

/**
 * The visa panel sits in its own deferred section, so it mounts a beat after the
 * trip page. Callers want the nationality field, which is the only control
 * available before a passport is picked.
 */
async function openVisa(gateway?: AppGateway) {
  renderApp(gateway ?? createMockGateway());
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  const region = await screen.findByRole("region", {
    name: "Visa & entry preparation",
  });
  await within(region).findByLabelText("Passport country code");
  return region;
}

/** The visa region of another trip, from an already-rendered workspace. */
async function openVisaFor(tripName: string) {
  fireEvent.click(
    await screen.findByRole("button", { name: `Open ${tripName}` }),
  );
  await screen.findByRole("heading", { name: tripName, level: 1 });
  const region = await screen.findByRole("region", {
    name: "Visa & entry preparation",
  });
  await within(region).findByLabelText("Passport country code");
  return region;
}

/** Pick a passport and wait for the journey to resolve. */
async function pickPassport(region: HTMLElement, code = "IN") {
  fireEvent.change(within(region).getByLabelText("Passport country code"), {
    target: { value: code },
  });
  fireEvent.click(within(region).getByRole("button", { name: "Save" }));
  await within(region).findByText(/Step 1/);
}

/**
 * ADR-0006 is the contract this panel exists to keep: Voyalier points at
 * authorities and never speaks for them. These tests are mostly about what the
 * panel refuses to say.
 */
describe("visa preparation", () => {
  it("disclaims before a passport is even picked, and keeps disclaiming", async () => {
    const region = await openVisa();
    // Not conditional and not dismissible: it is the product's position, not a
    // notice about a state the traveler can resolve.
    const disclaimer = within(region).getByRole("note");
    expect(disclaimer).toHaveTextContent(
      /Voyalier does not decide whether you need a visa/,
    );

    await pickPassport(region);
    expect(within(region).getByRole("note")).toHaveTextContent(
      /has not verified anything here/,
    );
  });

  it("offers the last passport to a new trip without adopting it", async () => {
    const region = await openVisa();
    await pickPassport(region, "IN");

    fireEvent.click(screen.getByRole("button", { name: "All trips" }));
    await screen.findByRole("heading", { name: "Trips", level: 1 });
    const lisbon = await openVisaFor("Lisbon spring draft");

    // A passport does not change per trip, so the picker starts where the
    // traveler left off rather than asking again.
    expect(within(lisbon).getByLabelText("Passport country code")).toHaveValue(
      "IN",
    );
    // Offered, not applied: a trip may not be for them, so nothing resolves
    // until they save it themselves.
    expect(within(lisbon).queryByText(/Step 1/)).toBeNull();
  });

  it("quotes the entry path with its source and the date it was read", async () => {
    const region = await openVisa();
    await pickPassport(region);

    // Never a bare assertion: the authority and the curation date travel with it.
    expect(within(region).getByText(/Quoted from/)).toHaveTextContent(
      /Immigration, Refugees and Citizenship Canada/,
    );
    expect(within(region).getByText(/read on/)).toHaveTextContent(
      /\d{4}-\d{2}-\d{2}/,
    );
    expect(
      within(region).getByRole("link", {
        name: /Confirm your own case at the official source/,
      }),
    ).toHaveAttribute("href", expect.stringContaining("https://"));
  });

  it("keeps a ticked document, and attributes the count to the traveler", async () => {
    const gateway = createMockGateway();
    const region = await openVisa(gateway);
    await pickPassport(region);

    const checkbox = within(region).getAllByRole("checkbox")[0];
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(within(region).getAllByRole("checkbox")[0]).toBeChecked(),
    );

    // The progress line says who counted, in the same sentence as the number.
    expect(
      within(region).getByText(/You marked \d+ of \d+ steps/),
    ).toHaveTextContent(/Voyalier has not verified any of them/);
  });

  it("saves a note against a document and reloads it", async () => {
    const gateway = createMockGateway();
    const region = await openVisa(gateway);
    await pickPassport(region);

    const note = within(region).getAllByLabelText(
      /Your note \(private, encrypted at rest\)/,
    )[0];
    fireEvent.change(note, { target: { value: "asked HDFC 12 Jul" } });
    fireEvent.blur(note);

    await waitFor(async () => {
      const stored = await gateway.getVisaPrep("trip_kyoto");
      expect(stored.items[0]?.note).toBe("asked HDFC 12 Jul");
    });
  });

  it("refuses a nationality that is not an ISO alpha-2 code", async () => {
    const region = await openVisa();
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "I" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    await within(region).findByRole("alert");
    // And nothing is invented in the meantime.
    expect(within(region).queryByText(/Step 1/)).toBeNull();
  });

  it("shows links and no journey when the route is not curated", async () => {
    const region = await openVisa();
    // Canada publishes conditions for Mexico rather than an answer, so the
    // golden resolves it to unknown and the panel must not fill the gap.
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "MX" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    await within(region).findByText(/No step-by-step guide for this route yet/);
    expect(within(region).queryByText(/Step 1/)).toBeNull();
  });

  it("reports the traveler's own tally on readiness without clearing it", async () => {
    const region = await openVisa();
    await pickPassport(region);
    fireEvent.click(within(region).getAllByRole("checkbox")[0]);

    const readiness = await screen.findByRole("region", { name: "Readiness" });
    await waitFor(() =>
      expect(readiness).toHaveTextContent(/visa prep steps done/),
    );
    // The item still asserts nothing: it reads "Check yourself", never a status
    // that could imply Voyalier cleared entry requirements.
    expect(readiness).toHaveTextContent(/Check yourself/);
    expect(readiness).toHaveTextContent(
      /Voyalier has not verified any of them/,
    );
  });

  it("has no accessibility violations with a journey open", async () => {
    const region = await openVisa();
    await pickPassport(region);
    expect(await findA11yViolations()).toEqual([]);
  });
});
