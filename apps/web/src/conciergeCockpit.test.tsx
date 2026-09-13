import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AttachmentContent } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

describe("concierge cockpit", () => {
  it("carries a setup brief to explicit provider handoffs", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      title: "Family Hawaiʻi",
      origin: "Chicago",
      destination: "Hawaii",
      startDate: "2026-11-30",
      endDate: "2026-12-14",
    });
    const workspace = await gateway.getConciergeWorkspace(trip.id);
    await gateway.setConciergeProfile({
      ...workspace.profile,
      preferences: {
        ...workspace.profile.preferences,
        selectedArea: "Oʻahu",
        partySize: 4,
        bedrooms: 2,
      },
    });

    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Family Hawaiʻi" }),
    );
    const cockpit = await screen.findByRole("heading", {
      name: "Everything between here and there",
    });
    const region = cockpit.closest("section")!;
    expect(within(region).getByText("Chicago")).toBeInTheDocument();
    expect(within(region).getAllByText("Oʻahu").length).toBeGreaterThan(0);
    fireEvent.click(
      within(region).getByRole("button", { name: "Prepare Airbnb" }),
    );
    expect(
      await within(region).findByRole("link", { name: /Open Airbnb/ }),
    ).toHaveAttribute("href", "https://www.airbnb.com/oahu-hi/stays");
    expect(within(region).getAllByText(/4 travelers/).length).toBeGreaterThan(
      0,
    );
    expect(within(region).getAllByText(/2 bedrooms/).length).toBeGreaterThan(0);
  });

  it("keeps provider results and traveler completion explicitly qualified", async () => {
    renderApp();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByText(
        /Prices, availability, ratings and account details stay on each provider/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("You marked complete")).toBeInTheDocument();
  });

  it("accepts a fresh trip projection without discarding an unsaved setup draft", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    expect(
      await screen.findByText("Plan local transportation"),
    ).toBeInTheDocument();

    const travelers = screen.getByLabelText("Travelers");
    fireEvent.change(travelers, { target: { value: "4" } });

    const plans = screen.getByRole("region", {
      name: "Activities & transfers",
    });
    fireEvent.change(within(plans).getByLabelText("Name"), {
      target: { value: "Airport transfer" },
    });
    fireEvent.click(within(plans).getByRole("button", { name: "Add to plan" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Plan local transportation"),
      ).not.toBeInTheDocument(),
    );
    expect(travelers).toHaveValue(4);
  });

  it("reopens route-sensitive work after a destination edit without leaving the trip", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      title: "Route review",
      origin: "Chicago",
      destination: "Hawaii",
      startDate: "2026-11-30",
      endDate: "2026-12-14",
    });
    const workspace = await gateway.getConciergeWorkspace(trip.id);
    await gateway.setConciergeProfile({
      ...workspace.profile,
      travelers: [
        {
          id: "traveler_one",
          displayName: "Traveler 1",
          passportCountryIso2: "IN",
          residenceCountryIso2: "US",
          residenceStatus: "temporary_worker",
        },
      ],
      taskProgress: [
        {
          taskId: "review-entry",
          state: "done_by_traveler",
          note: "Reviewed for the original route",
          contextRevision: trip.updatedAt,
        },
      ],
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Route review" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit trip" });
    fireEvent.change(within(dialog).getByLabelText(/^To/), {
      target: { value: "Montréal" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    const progress = await screen.findByLabelText(
      "Progress for Review each traveler's official route",
    );
    await waitFor(() => expect(progress).toHaveValue("needs_recheck"));
    expect(
      await screen.findByRole("button", { name: "Prepare Expedia" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Use Canada’s official entry-requirements tool"),
    ).toBeInTheDocument();
  });

  it("stores a supported binary file in the encrypted wallet flow", async () => {
    const gateway = createMockGateway();
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    const input = await screen.findByLabelText("Add PDF or image");
    const pdf = new File(
      [new TextEncoder().encode("%PDF-1.4 fixture")],
      "entry-letter.pdf",
      {
        type: "application/pdf",
      },
    );
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(
      (await screen.findAllByText("entry-letter.pdf")).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText(/encrypted file\(s\)/)).toBeInTheDocument();
    expect(await gateway.listAttachments("trip_kyoto")).toHaveLength(1);
  });

  it("previews an encrypted file in memory and releases the object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:voyalier-preview");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    try {
      const gateway = createMockGateway();
      await gateway.importAttachment({
        tripId: "trip_kyoto",
        label: "entry-letter.pdf",
        mimeType: "application/pdf",
        contentBase64: "JVBERi0xLjQ=",
      });
      renderApp(gateway);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Open Kyoto autumn journey",
        }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
      expect(
        await screen.findByTitle("Preview of entry-letter.pdf"),
      ).toHaveAttribute("src", "blob:voyalier-preview");
      fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
      await waitFor(() =>
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:voyalier-preview"),
      );
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevoke,
      });
    }
  });

  it("does not materialize a decrypted preview after the cockpit unmounts", async () => {
    const createObjectURL = vi.fn(() => "blob:late-preview");
    const originalCreate = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    try {
      const base = createMockGateway();
      const attachment = await base.importAttachment({
        tripId: "trip_kyoto",
        label: "entry-letter.pdf",
        mimeType: "application/pdf",
        contentBase64: "JVBERi0xLjQ=",
      });
      let resolvePreview!: (content: AttachmentContent) => void;
      const pending = new Promise<AttachmentContent>((resolve) => {
        resolvePreview = resolve;
      });
      const gateway = {
        ...base,
        getAttachment: vi.fn(() => pending),
      };
      const view = renderApp(gateway);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Open Kyoto autumn journey",
        }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
      await waitFor(() => expect(gateway.getAttachment).toHaveBeenCalledOnce());
      view.unmount();
      resolvePreview({ attachment, contentBase64: "JVBERi0xLjQ=" });
      await Promise.resolve();
      await Promise.resolve();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreate,
      });
    }
  });

  it("ignores an older decrypted preview request that finishes last", async () => {
    const createObjectURL = vi.fn(() => "blob:newest-preview");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    try {
      const base = createMockGateway();
      const attachment = await base.importAttachment({
        tripId: "trip_kyoto",
        label: "entry-letter.pdf",
        mimeType: "application/pdf",
        contentBase64: "JVBERi0xLjQ=",
      });
      let resolveFirst!: (content: AttachmentContent) => void;
      let resolveSecond!: (content: AttachmentContent) => void;
      const first = new Promise<AttachmentContent>((resolve) => {
        resolveFirst = resolve;
      });
      const second = new Promise<AttachmentContent>((resolve) => {
        resolveSecond = resolve;
      });
      const gateway = {
        ...base,
        getAttachment: vi
          .fn()
          .mockReturnValueOnce(first)
          .mockReturnValueOnce(second),
      };
      renderApp(gateway);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Open Kyoto autumn journey",
        }),
      );
      const previewButton = await screen.findByRole("button", {
        name: "Preview",
      });
      fireEvent.click(previewButton);
      fireEvent.click(previewButton);
      await waitFor(() =>
        expect(gateway.getAttachment).toHaveBeenCalledTimes(2),
      );
      resolveSecond({ attachment, contentBase64: "JVBERi0xLjQ=" });
      expect(
        await screen.findByTitle("Preview of entry-letter.pdf"),
      ).toHaveAttribute("src", "blob:newest-preview");
      resolveFirst({ attachment, contentBase64: "JVBERi0xLjQ=" });
      await Promise.resolve();
      await Promise.resolve();
      expect(createObjectURL).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevoke,
      });
    }
  });

  it("keeps multiple island bases and creates their transfer work", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      title: "Island split",
      origin: "Chicago",
      destination: "Hawaii",
      startDate: "2026-11-30",
      endDate: "2026-12-14",
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Island split" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Oʻahu as a base" }),
    );
    await waitFor(async () =>
      expect(await gateway.getConciergeWorkspace(trip.id)).toEqual(
        expect.objectContaining({
          profile: expect.objectContaining({
            preferences: expect.objectContaining({
              areaStays: [expect.objectContaining({ area: "Oʻahu" })],
            }),
          }),
        }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Maui as a base" }),
    );
    expect(
      await screen.findByText("Plan the transfer from Oʻahu to Maui"),
    ).toBeInTheDocument();
  });

  it("records a cost while its amount and taxes remain unknown", async () => {
    renderApp();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    fireEvent.change(await screen.findByLabelText("Item"), {
      target: { value: "Hotel taxes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add amount" }));
    expect(await screen.findByText("Hotel taxes")).toBeInTheDocument();
    expect(
      screen.getByText(/Amount not entered · taxes unknown/),
    ).toBeInTheDocument();
  });

  it("keeps Montréal entry and U.S. return as separate sourced steps", async () => {
    const gateway = createMockGateway();
    const trip = await gateway.createTrip({
      title: "Montréal week",
      origin: "Chicago",
      destination: "Montréal",
      startDate: "2027-05-01",
      endDate: "2027-05-08",
    });
    const workspace = await gateway.getConciergeWorkspace(trip.id);
    await gateway.setConciergeProfile({
      ...workspace.profile,
      preferences: { ...workspace.profile.preferences, partySize: 2 },
      travelers: [
        {
          id: "worker",
          displayName: "Traveler 1",
          passportCountryIso2: "IN",
          residenceCountryIso2: "US",
          residenceStatus: "temporary_worker",
        },
        {
          id: "resident",
          displayName: "Traveler 2",
          passportCountryIso2: "IN",
          residenceCountryIso2: "US",
          residenceStatus: "permanent_resident",
        },
      ],
    });
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Montréal week" }),
    );
    expect(
      await screen.findByText("Review the U.S. permanent-resident route"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review the return-to-U.S. temporary-worker documents"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review the return-to-U.S. permanent-resident documents",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare Expedia" }));
    expect(
      await screen.findByRole("link", { name: /Open Expedia/ }),
    ).toHaveAttribute(
      "href",
      "https://www.expedia.com/Montreal-Hotels.d178288.Travel-Guide-Hotels",
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare AllTrails" }));
    expect(
      await screen.findByRole("link", { name: /Open AllTrails/ }),
    ).toHaveAttribute(
      "href",
      "https://www.alltrails.com/trail/canada/quebec/visite-a-pied-panoramique-de-montreal",
    );
  });
});
