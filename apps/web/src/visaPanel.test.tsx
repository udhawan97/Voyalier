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
 * Where the traveler's own country keeps a mission, shown as a pointer.
 *
 * The mock carries one Canadian embassy for the Japan fixture, matching the
 * bundled extract's own record — including that Wikidata files it under the
 * ward, Akasaka, rather than under Tokyo.
 */
describe("diplomatic missions", () => {
  it("names the mission and says to confirm it elsewhere", async () => {
    const region = await openVisa();
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "CA" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));
    expect(
      await within(region).findByText(/Embassy in Akasaka/i),
    ).toBeInTheDocument();
    // The claim is bounded in the copy: confirm it with your own ministry.
    expect(
      within(region).getByText(/Confirm the address and hours/i),
    ).toBeInTheDocument();
  });

  it("says nothing at all when no passport is chosen", async () => {
    const region = await openVisa();
    expect(within(region).queryByText(/Embassy in/i)).toBeNull();
    expect(
      within(region).queryByText(/Your country's missions here/i),
    ).toBeNull();
  });
});

/**
 * Open a step that actually asks for documents.
 *
 * A journey opens on its orientation step, which is links and no documents —
 * so anything about ticking or noting has to move off it first.
 */
async function openAskableStep(region: HTMLElement) {
  fireEvent.click(within(region).getByRole("button", { name: /Mock step 2/ }));
  await within(region).findByText(/Step 2/);
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

    // Never a bare assertion: the authority and the curation date travel with
    // it — and the authority is the one that governs *this* destination. The
    // fixture trip goes to Kyoto, so it must be Japan's ministry quoted here;
    // this read "Immigration, Refugees and Citizenship Canada" while Canada was
    // the only curated destination.
    expect(within(region).getByText(/Quoted from/)).toHaveTextContent(
      /Ministry of Foreign Affairs of Japan/,
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
    await openAskableStep(region);

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
    await openAskableStep(region);

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

  it("reaches its own total once every document is ticked", async () => {
    const gateway = createMockGateway();
    await gateway.setVisaNationality({
      tripId: "trip_kyoto",
      nationalityIso2: "IN",
    });
    const prep = await gateway.getVisaPrep("trip_kyoto");
    const journey = prep.journey!;
    // The premise: a real journey opens with an orientation step that asks for
    // nothing. If the fixture ever loses it this test stops proving anything.
    expect(journey.steps.some((step) => step.documents.length === 0)).toBe(
      true,
    );

    for (const document of journey.steps.flatMap((step) => step.documents)) {
      await gateway.setVisaItemProgress({
        tripId: "trip_kyoto",
        documentId: document.id,
        checked: true,
      });
    }

    const region = await openVisa(gateway);
    await within(region).findByText(/Step 1/);

    // A step with nothing to tick can never be ticked, so counting it in the
    // denominator left the journey reading "7 of 8" with every box checked and
    // no remaining action anywhere in the panel.
    const askable = journey.steps.filter((step) => step.documents.length > 0);
    expect(within(region).getByText(/You marked/)).toHaveTextContent(
      `You marked ${askable.length} of ${askable.length} steps complete`,
    );
  });

  it("moves focus into the step it opens", async () => {
    const region = await openVisa();
    await pickPassport(region);

    fireEvent.click(
      within(region).getByRole("button", { name: /Mock step 5/ }),
    );

    // Where the rail stacks above the detail — every narrow viewport — the tap
    // otherwise changed something 100px below the fold and nothing moved.
    await waitFor(() =>
      expect(
        within(region).getByRole("heading", { name: /Step 5/ }),
      ).toHaveFocus(),
    );
  });

  it("marks the passport field invalid and names the rule it broke", async () => {
    const region = await openVisa();
    const field = within(region).getByLabelText("Passport country code");
    fireEvent.change(field, { target: { value: "I" } });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    const error = await within(region).findByRole("alert");
    // Not the multi-field banner title. "Check the highlighted fields" pointed
    // at a highlight this form had no way to draw.
    expect(error).toHaveTextContent(/two letters/i);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("answers when Save is pressed with nothing typed", async () => {
    const region = await openVisa();
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    // It used to return silently, so a real button did nothing observable.
    const error = await within(region).findByRole("alert");
    expect(error).toHaveTextContent(/two letters/i);
    expect(
      within(region).getByLabelText("Passport country code"),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("builds the no-journey state without nesting blocks inside a paragraph", async () => {
    const region = await openVisa();
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "MX" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));
    await within(region).findByText(/No step-by-step guide for this route yet/);

    // React only warns about this; the DOM it builds is genuinely invalid, and
    // would not survive being parsed rather than constructed.
    expect(region.querySelector("p p, p ul, p div")).toBeNull();
  });

  it("reports the traveler's own tally on readiness without clearing it", async () => {
    const region = await openVisa();
    await pickPassport(region);
    await openAskableStep(region);
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

  /**
   * The destination decides the answer, so editing it has to reach this panel.
   *
   * Measured on the running product: changing Tokyo to Toronto updated the trip
   * heading and left the cockpit reading "No step-by-step guide for this route
   * yet" while the engine already held an eight-step journey. Only a reload
   * revealed it. The edit handler called reload(), which re-runs the detail
   * view's own query; this panel reads its own scope and was never told.
   */
  it("refetches when the trip's destination changes", async () => {
    const base = createMockGateway();
    let visaReads = 0;
    const gateway = {
      ...base,
      getVisaPrep: (tripId: string) => {
        visaReads += 1;
        return base.getVisaPrep(tripId);
      },
    };
    const region = await openVisa(gateway as typeof base);
    await pickPassport(region);
    const before = visaReads;

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit trip" });
    fireEvent.change(within(dialog).getByLabelText(/^To/), {
      target: { value: "Toronto" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(visaReads).toBeGreaterThan(before));
  });

  it("has no accessibility violations with a journey open", async () => {
    const region = await openVisa();
    await pickPassport(region);
    expect(await findA11yViolations()).toEqual([]);
  });
});
