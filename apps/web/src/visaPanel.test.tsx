import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
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
  it("names the mission behind its disclosure and says to confirm it elsewhere", async () => {
    const region = await openVisa();
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "CA" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    // Reference material, not a step: collapsed until asked for.
    const toggle = await within(region).findByRole("button", {
      name: /Your country's missions here/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(region).queryByText(/Embassy in Akasaka/i)).toBeNull();
    fireEvent.click(toggle);

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

    // Offered as a one-tap chip, never applied on their behalf: the field
    // stays empty and nothing resolves until the traveler acts. (This used to
    // prefill the field itself, which read as already-chosen.)
    expect(within(lisbon).getByLabelText("Passport country code")).toHaveValue(
      "",
    );
    expect(within(lisbon).queryByText(/Step 1/)).toBeNull();
    const chip = within(lisbon).getByRole("button", {
      name: /the passport from your last trip/i,
    });
    expect(chip).toHaveTextContent("IN");

    // One tap applies and saves — the curated Canada journey resolves.
    fireEvent.click(chip);
    await within(lisbon).findByText(/Step 1/);
    expect(
      within(lisbon).getByText(/read from .* on \d{4}-\d{2}-\d{2}/i),
    ).toBeInTheDocument();
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
    expect(within(region).getByText(/Checklist:/)).toHaveTextContent(
      /Voyalier has not verified any item/,
    );
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

  it("fills an uncurated route with the playbook, labelled as Voyalier's own", async () => {
    const region = await openVisa();
    // Japan's exemption for Thailand turns on a passport type Voyalier cannot
    // see, so no curated journey resolves — and that is no longer a dead end:
    // the universal playbook renders, wearing its authorship on its sleeve.
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "TH" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    await within(region).findByText(/written by Voyalier/);
    expect(
      within(region).getByText(/not read from any authority/),
    ).toBeInTheDocument();
    expect(
      await within(region).findByRole("button", {
        name: /Mock playbook step 1/,
      }),
    ).toBeInTheDocument();
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
    expect(within(region).getByText(/Checklist:/)).toHaveTextContent(
      `Checklist: ${askable.length} of ${askable.length} complete`,
    );
    expect(within(region).getByText(/Checklist:/)).toHaveTextContent(
      `${journey.steps.length} guide steps`,
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

  it("does not call valid passport input invalid when the engine is offline", async () => {
    const base = createMockGateway();
    const region = await openVisa({
      ...base,
      setVisaNationality: () =>
        Promise.reject({
          code: "transport/failure",
          message: "engine unreachable",
        }),
    });
    const field = within(region).getByLabelText("Passport country code");
    fireEvent.change(field, { target: { value: "US" } });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));

    await screen.findByText("Offline");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(within(region).queryByText(/Use two letters/)).toBeNull();
    expect(
      await screen.findByText("Voyalier can't reach its engine"),
    ).toBeInTheDocument();
  });

  it("builds the playbook state without nesting blocks inside a paragraph", async () => {
    const region = await openVisa();
    fireEvent.change(within(region).getByLabelText("Passport country code"), {
      target: { value: "TH" },
    });
    fireEvent.click(within(region).getByRole("button", { name: "Save" }));
    await within(region).findByText(/written by Voyalier/);

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

/**
 * The two zones this release added: the playbook for every route a journey
 * does not cover (spec 2026-08-02), and the ADR-0014 statistics card whose
 * figures exist only after this device read them from the authority.
 */
describe("visa cockpit v2", () => {
  afterEach(() => setLocalePreference("en"));

  /** A trip whose destination the mock maps to an uncurated country (FR). */
  async function openParis(gateway = createMockGateway()) {
    await gateway.createTrip({
      title: "Paris scouting",
      origin: "Delhi",
      destination: "Paris",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });
    renderApp(gateway);
    const region = await openVisaFor("Paris scouting");
    return { gateway, region };
  }

  it("renders the playbook for India → France instead of a dead end", async () => {
    const { region } = await openParis();
    await pickPassportViaField(region, "IN");

    await within(region).findByText(/written by Voyalier/);
    // Six steps, first one focusable through the rail like any journey.
    expect(
      within(region).getAllByRole("button", { name: /Mock playbook step/ }),
    ).toHaveLength(6);
    // France names no authority, and the panel says exactly that.
    expect(
      within(region).getByText(/has not curated an authority/),
    ).toBeInTheDocument();
    // No stats zone for a destination with no named authority.
    expect(within(region).queryByText(/published times/i)).toBeNull();
  });

  it("still prefers the curated journey where one exists", async () => {
    const region = await openVisa();
    await pickPassport(region);
    expect(
      within(region).getByText(/read from Ministry of Foreign Affairs/),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/written by Voyalier/)).toBeNull();
  });

  it("moves focus into a playbook step like any other", async () => {
    const { region } = await openParis();
    await pickPassportViaField(region, "IN");
    await within(region).findByText(/written by Voyalier/);

    fireEvent.click(
      within(region).getByRole("button", { name: /Mock playbook step 5/ }),
    );
    await waitFor(() =>
      expect(
        within(region).getByRole("heading", { name: /Step 5/ }),
      ).toHaveFocus(),
    );
  });

  it("suggests countries by name and accepts the picked code", async () => {
    const region = await openVisa();
    const field = within(region).getByLabelText("Passport country code");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Ind" } });

    await screen.findByRole("option", { name: /India — IN/ });
    // ArrowDown activates the first suggestion, Enter commits it — the
    // component's canonical path. India is the first name match for "Ind",
    // and the committed value is the code the contract takes.
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field).toHaveValue("IN"));

    fireEvent.click(within(region).getByRole("button", { name: "Save" }));
    await within(region).findByText(/Step 1/);
  });

  it("says an authority blocks reading where no dataset is published", async () => {
    // Kyoto → Japan: a named authority, no readable dataset. The card renders
    // in every state under the authority's own name.
    const region = await openVisa();
    await pickPassport(region);

    const stats = within(region).getByRole("region", {
      name: "Ministry of Foreign Affairs of Japan",
    });
    expect(
      within(stats).getByText(/Read them yourself at the official page/),
    ).toBeInTheDocument();
    expect(
      within(stats).queryByRole("button", {
        name: /Fetch current published times/,
      }),
    ).toBeNull();
    expect(
      within(stats).getByRole("link", {
        name: /Check current published times/,
      }),
    ).toBeInTheDocument();
  });

  it("fetches on consent, quotes verbatim, and names the source's own date", async () => {
    const gateway = createMockGateway();
    await gateway.createTrip({
      title: "London filing",
      origin: "Delhi",
      destination: "London",
      startDate: "2027-05-01",
      endDate: "2027-05-10",
    });
    renderApp(gateway);
    const region = await openVisaFor("London filing");
    await pickPassportViaField(region, "IN");
    await within(region).findByText(/written by Voyalier/);

    const stats = within(region).getByRole("region", {
      name: /UK Visas and Immigration/,
    });
    // The consent sentence names the host and the payload before any fetch.
    expect(
      within(stats).getByText(/Nothing about you or your trip is sent/),
    ).toBeInTheDocument();
    expect(within(stats).queryByRole("table")).toBeNull();

    fireEvent.click(
      within(stats).getByRole("button", {
        name: /Fetch current published times/,
      }),
    );

    expect(await within(stats).findByRole("table")).toBeInTheDocument();
    expect(within(stats).getByText("Standard Visitor")).toBeInTheDocument();
    expect(within(stats).getAllByText("3 weeks").length).toBeGreaterThan(0);
    // The source's own as-of date is never omitted when it publishes one.
    expect(
      within(stats).getByText(/states these figures as of/),
    ).toBeInTheDocument();
    // The licence rides with the figures.
    expect(
      within(stats).getByText(/Open Government Licence v3.0/),
    ).toBeInTheDocument();
  });

  it("marks the traveler's own row with text, never color alone", async () => {
    // Lisbon maps to Canada in the mock, and IRCC publishes per-country rows.
    const gateway = createMockGateway();
    renderApp(gateway);
    const region = await openVisaFor("Lisbon spring draft");
    await pickPassportViaField(region, "IN");
    await within(region).findByText(/Step 1/);

    const stats = within(region).getByRole("region", {
      name: /Immigration, Refugees and Citizenship Canada/,
    });
    fireEvent.click(
      within(stats).getByRole("button", {
        name: /Fetch current published times/,
      }),
    );
    await within(stats).findByRole("table");

    expect(within(stats).getAllByText(/your passport/).length).toBeGreaterThan(
      0,
    );
    expect(within(stats).getByText(/confirm it is yours/)).toBeInTheDocument();
  });

  it("keeps the stored copy visible and loud when a refresh fails", async () => {
    const base = createMockGateway();
    await base.createTrip({
      title: "London filing",
      origin: "Delhi",
      destination: "London",
      startDate: "2027-05-01",
      endDate: "2027-05-10",
    });
    const trips = await base.listTrips();
    const london = trips.find((trip) => trip.title === "London filing")!;
    await base.setVisaNationality({
      tripId: london.id,
      nationalityIso2: "IN",
    });
    // A copy is stored, then the authority goes unreachable.
    await base.refreshVisaStats(london.id);
    const gateway = {
      ...base,
      refreshVisaStats: () =>
        Promise.reject({
          code: "advice/fetch_failed",
          message: "unreachable",
        }),
    };
    renderApp(gateway as typeof base);
    const region = await openVisaFor("London filing");
    await within(region).findByText(/written by Voyalier/);

    const stats = within(region).getByRole("region", {
      name: /UK Visas and Immigration/,
    });
    // The kept copy renders without any fetch this session.
    expect(await within(stats).findByRole("table")).toBeInTheDocument();

    fireEvent.click(
      within(stats).getByRole("button", {
        name: /Fetch current published times/,
      }),
    );
    // Loud, and the copy survives.
    expect(
      await within(stats).findByText(/showing the copy saved/),
    ).toBeInTheDocument();
    expect(within(stats).getByRole("table")).toBeInTheDocument();
  });

  it("marks a kept copy older than a week and says to fetch again", async () => {
    const base = createMockGateway();
    await base.createTrip({
      title: "London filing",
      origin: "Delhi",
      destination: "London",
      startDate: "2027-05-01",
      endDate: "2027-05-10",
    });
    const trips = await base.listTrips();
    const london = trips.find((trip) => trip.title === "London filing")!;
    await base.setVisaNationality({
      tripId: london.id,
      nationalityIso2: "IN",
    });
    await base.refreshVisaStats(london.id);
    // Age the kept copy past the advice staleness window on the way out.
    const gateway = {
      ...base,
      getVisaPrep: async (tripId: string) => {
        const prep = await base.getVisaPrep(tripId);
        if (prep.stats?.snapshot) {
          prep.stats.snapshot.retrievedAt = "2026-07-01T00:00:00Z";
        }
        return prep;
      },
    };
    renderApp(gateway as typeof base);
    const region = await openVisaFor("London filing");

    const stats = within(region).getByRole("region", {
      name: /UK Visas and Immigration/,
    });
    expect(await within(stats).findByRole("table")).toBeInTheDocument();
    expect(
      within(stats).getByText(/days ago — fetch again before you rely on it/),
    ).toBeInTheDocument();
  });

  it("renders the playbook banner in Spanish chrome around English steps", async () => {
    setLocalePreference("es");
    const gateway = createMockGateway();
    await gateway.createTrip({
      title: "Paris scouting",
      origin: "Delhi",
      destination: "Paris",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: /Paris scouting/ }),
    );
    await screen.findByRole("heading", { name: "Paris scouting", level: 1 });
    const region = await screen.findByRole("region", {
      name: "Visado y preparación de entrada",
    });
    const field = await within(region).findByLabelText(
      "Código de país del pasaporte",
    );
    fireEvent.change(field, { target: { value: "IN" } });
    fireEvent.click(within(region).getByRole("button", { name: "Guardar" }));

    // The banner is chrome and translates; the steps carry their own language
    // tag so a screen reader is not misled.
    await within(region).findByText(/escrita por Voyalier/);
    const guide = document.querySelector(".voy-visa__journey");
    expect(guide).toHaveAttribute("lang", "en");
  });

  it("has no accessibility violations with playbook, stats, and missions open", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    const region = await openVisaFor("Lisbon spring draft");
    await pickPassportViaField(region, "IN");
    await within(region).findByText(/Step 1/);

    const missionsToggle = within(region).queryByRole("button", {
      name: /Your country's missions here/i,
    });
    if (missionsToggle) fireEvent.click(missionsToggle);
    const fetchButton = within(region).queryByRole("button", {
      name: /Fetch current published times/,
    });
    if (fetchButton) fireEvent.click(fetchButton);
    await waitFor(async () => expect(await findA11yViolations()).toEqual([]));
  });
});

/** Type a code into the combobox field and save — no suggestion interaction. */
async function pickPassportViaField(region: HTMLElement, code: string) {
  fireEvent.change(within(region).getByLabelText("Passport country code"), {
    target: { value: code },
  });
  fireEvent.click(within(region).getByRole("button", { name: "Save" }));
}
