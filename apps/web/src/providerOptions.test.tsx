import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway, type AppGateway } from "@voyalier/contracts";
import { renderApp } from "./test/helpers";

async function openCockpit(gateway: AppGateway) {
  renderApp(gateway);
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  return (
    await screen.findByRole("heading", {
      name: "Everything between here and there",
    })
  ).closest("section")!;
}

describe("concierge save recovery", () => {
  it.each([
    ["Name in this trip", "Add person", "Me"],
    ["Wallet label", "Add to wallet", "Return permission"],
    ["Item", "Add amount", "Train estimate"],
  ])(
    "retains a rejected %s draft and clears it only after a successful retry",
    async (field, button, value) => {
      const base = createMockGateway();
      const workspace = await base.getConciergeWorkspace("trip_kyoto");
      await base.setConciergeProfile({
        ...workspace.profile,
        preferences: { ...workspace.profile.preferences, partySize: 3 },
      });
      let reject = true;
      const setConciergeProfile = vi.fn(
        async (profile: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
          if (reject)
            throw {
              code: "validation/invalid_input",
              message: "Rejected synthetic draft",
            };
          return base.setConciergeProfile(profile);
        },
      );
      const cockpit = await openCockpit({ ...base, setConciergeProfile });
      const input = within(cockpit).getByRole("textbox", { name: field });
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() =>
        expect(within(cockpit).getByRole("alert")).toBeInTheDocument(),
      );
      expect(input).toHaveValue(value);
      reject = false;
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(input).toHaveValue(""));
      expect(setConciergeProfile).toHaveBeenCalledTimes(2);
      // The button remains available for a deliberate retry, rather than clearing the form.
      expect(
        within(cockpit).getByRole("button", { name: button }),
      ).toBeInTheDocument();
    },
  );

  it.each(["Name in this trip", "Wallet label", "Item"])(
    "preserves a newer %s draft after an earlier save succeeds",
    async (field) => {
      const base = createMockGateway();
      const workspace = await base.getConciergeWorkspace("trip_kyoto");
      await base.setConciergeProfile({
        ...workspace.profile,
        preferences: { ...workspace.profile.preferences, partySize: 3 },
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const setConciergeProfile = vi.fn(
        async (profile: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
          await gate;
          return base.setConciergeProfile(profile);
        },
      );
      const cockpit = await openCockpit({ ...base, setConciergeProfile });
      const input = within(cockpit).getByRole("textbox", { name: field });
      fireEvent.change(input, { target: { value: "First estimate" } });
      fireEvent.submit(input.closest("form")!);
      fireEvent.change(input, { target: { value: "Next estimate" } });
      await act(async () => {
        release();
        await gate;
      });
      await waitFor(() =>
        expect(
          within(cockpit).getAllByText("First estimate").length,
        ).toBeGreaterThan(0),
      );
      expect(input).toHaveValue("Next estimate");
    },
  );

  it("owns concurrent provider and form saves synchronously", async () => {
    const base = createMockGateway();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setConciergeProfile = vi.fn(
      async (profile: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
        await gate;
        return base.setConciergeProfile(profile);
      },
    );
    const cockpit = await openCockpit({ ...base, setConciergeProfile });
    const input = within(cockpit).getByRole("textbox", { name: "Item" });
    fireEvent.change(input, { target: { value: "Retained estimate" } });
    act(() => {
      within(cockpit).getByRole("button", { name: "Prepare Airbnb" }).click();
      input
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(setConciergeProfile).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Retained estimate");
    await act(async () => {
      release();
      await gate;
    });
    expect(
      await within(cockpit).findByRole("link", { name: /Open Airbnb/ }),
    ).toBeInTheDocument();
  });

  it("retains a newer setup generation while keeping the acknowledged baseline available", async () => {
    const base = createMockGateway();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cockpit = await openCockpit({
      ...base,
      setConciergeProfile: async (profile) => {
        await gate;
        return base.setConciergeProfile(profile);
      },
    });
    const bedrooms = within(cockpit).getByRole("spinbutton", {
      name: "Bedrooms",
    });
    fireEvent.change(bedrooms, { target: { value: "2" } });
    fireEvent.click(
      within(cockpit).getByRole("button", { name: "Save setup" }),
    );
    fireEvent.change(bedrooms, { target: { value: "3" } });
    await act(async () => {
      release();
      await gate;
    });
    expect(bedrooms).toHaveValue(3);
    expect(
      within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
    ).toBeDisabled();
    expect(
      (await base.getConciergeWorkspace("trip_kyoto")).profile.preferences
        .bedrooms,
    ).toBe(2);
    fireEvent.click(
      within(cockpit).getByRole("button", {
        name: "Discard setup draft and use saved profile",
      }),
    );
    expect(bedrooms).toHaveValue(2);
  });

  it("requires explicit draft reconciliation before a provider mutation", async () => {
    const base = createMockGateway();
    const setConciergeProfile = vi.fn(base.setConciergeProfile);
    const cockpit = await openCockpit({ ...base, setConciergeProfile });
    fireEvent.change(
      within(cockpit).getByRole("spinbutton", { name: "Bedrooms" }),
      { target: { value: "3" } },
    );
    expect(
      within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
    ).toBeDisabled();
    expect(setConciergeProfile).not.toHaveBeenCalled();
    fireEvent.click(
      within(cockpit).getByRole("button", {
        name: "Discard setup draft and use saved profile",
      }),
    );
    fireEvent.click(
      within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
    );
    await waitFor(() => expect(setConciergeProfile).toHaveBeenCalledTimes(1));
  });

  it("persists a delayed provider handoff after navigation without announcing the departed panel", async () => {
    const base = createMockGateway();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cockpit = await openCockpit({
      ...base,
      setConciergeProfile: async (profile) => {
        await gate;
        return base.setConciergeProfile(profile);
      },
    });
    fireEvent.click(
      within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Voyalier — all trips" }),
    );
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(async () =>
      expect(
        (await base.getConciergeWorkspace("trip_kyoto")).profile
          .providerHandoffs,
      ).toHaveLength(1),
    );
    expect(
      screen.queryByText("Airbnb handoff saved. The provider link is ready."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open Airbnb/ }),
    ).not.toBeInTheDocument();
  });

  it.each(["before", "during"])(
    "fences a workspace read started %s a later acknowledged save",
    async (timing) => {
      const base = createMockGateway();
      let delay = false;
      let captured = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let releaseWrite!: () => void;
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      const setConciergeProfile = vi.fn(
        async (profile: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
          await writeGate;
          return base.setConciergeProfile(profile);
        },
      );
      const getConciergeWorkspace = vi.fn(async (tripId: string) => {
        const snapshot = await base.getConciergeWorkspace(tripId);
        if (delay) {
          captured = true;
          await gate;
        }
        return snapshot;
      });
      const cockpit = await openCockpit({
        ...base,
        getConciergeWorkspace,
        setConciergeProfile,
      });
      const bedrooms = within(cockpit).getByRole("spinbutton", {
        name: "Bedrooms",
      });
      function startSave() {
        fireEvent.change(bedrooms, { target: { value: "3" } });
        fireEvent.click(
          within(cockpit).getByRole("button", { name: "Save setup" }),
        );
      }
      if (timing === "during") startSave();
      delay = true;
      const plans = screen.getByRole("region", {
        name: "Activities & transfers",
      });
      fireEvent.change(within(plans).getByLabelText("Name"), {
        target: { value: "Concurrent plan" },
      });
      fireEvent.click(
        within(plans).getByRole("button", { name: "Add to plan" }),
      );
      await waitFor(() => expect(captured).toBe(true));
      if (timing === "before") startSave();
      await act(async () => {
        releaseWrite();
        await writeGate;
      });
      await waitFor(() =>
        expect(
          within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
        ).toBeEnabled(),
      );
      const accepted = (await base.getConciergeWorkspace("trip_kyoto")).profile;
      delay = false;
      await act(async () => {
        release();
        await gate;
      });
      expect(bedrooms).toHaveValue(3);
      fireEvent.click(
        within(cockpit).getByRole("button", { name: "Prepare Airbnb" }),
      );
      await waitFor(() => expect(setConciergeProfile).toHaveBeenCalledTimes(2));
      const submitted = setConciergeProfile.mock.calls[1][0];
      expect(submitted).toMatchObject({
        preferences: accepted.preferences,
        updatedAt: accepted.updatedAt,
      });
      if ("revision" in accepted)
        expect(submitted).toHaveProperty("revision", accepted.revision);
    },
  );

  it.each([false, true])(
    "finishes upload scope refresh after navigation when acknowledgement rejects=%s",
    async (reject) => {
      const base = createMockGateway();
      await base.createTrip({
        title: "Other trip",
        origin: "Chicago",
        destination: "Tokyo",
        startDate: "2026-12-01",
        endDate: "2026-12-07",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const setConciergeProfile = vi.fn(
        async (profile: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
          await gate;
          if (reject)
            throw {
              code: "validation/invalid_input",
              message: "Synthetic delayed link rejection",
            };
          return base.setConciergeProfile(profile);
        },
      );
      const getConciergeWorkspace = vi.fn(base.getConciergeWorkspace);
      const cockpit = await openCockpit({
        ...base,
        getConciergeWorkspace,
        setConciergeProfile,
      });
      const file = new File(["%PDF-1.4 fixture"], "background.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(within(cockpit).getByLabelText("Add PDF or image"), {
        target: { files: [file] },
      });
      await waitFor(() => expect(setConciergeProfile).toHaveBeenCalledTimes(1));
      fireEvent.click(
        screen.getByRole("button", { name: "Voyalier — all trips" }),
      );
      expect(
        screen.queryByRole("heading", {
          name: "Everything between here and there",
        }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        await screen.findByRole("button", { name: "Open Other trip" }),
      );
      await screen.findByRole("heading", { name: "Other trip", level: 1 });
      fireEvent.click(
        screen.getByRole("button", { name: "Voyalier — all trips" }),
      );
      // Reopen while the old editor still awaits acknowledgement; this mounts a new owner.
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Open Kyoto autumn journey",
        }),
      );
      await screen.findByRole("heading", {
        name: "Everything between here and there",
      });
      const reads = getConciergeWorkspace.mock.calls.length;
      await act(async () => {
        release();
        await gate;
      });
      await waitFor(() =>
        expect(getConciergeWorkspace.mock.calls.length).toBeGreaterThan(reads),
      );
      expect(await base.listAttachments("trip_kyoto")).toHaveLength(1);
      expect(
        (await base.getConciergeWorkspace("trip_kyoto")).profile.walletLinks,
      ).toHaveLength(reject ? 0 : 1);
    },
  );

  it("keeps source availability unknown on a failed load and resolves it on retry", async () => {
    const base = createMockGateway();
    const documents = await base.listDocuments("trip_kyoto");
    const source = documents[0].document;
    const workspace = await base.getConciergeWorkspace("trip_kyoto");
    await base.setConciergeProfile({
      ...workspace.profile,
      walletLinks: [
        {
          id: "linked-source",
          label: "Saved source",
          category: "confirmation",
          travelerIds: [],
          preparationRequirementIds: [],
          sourceDocumentId: source.id,
          note: "",
        },
      ],
    });
    let fail = true;
    const listDocuments = vi.fn(async (tripId: string) => {
      if (fail)
        throw {
          code: "transport/failure",
          message: "Offline synthetic source load",
        };
      return base.listDocuments(tripId);
    });
    const cockpit = await openCockpit({ ...base, listDocuments });
    expect(
      await within(cockpit).findByText(/Source unavailable/),
    ).toBeInTheDocument();
    expect(
      within(cockpit).queryByText(/Source removed/),
    ).not.toBeInTheDocument();
    expect(
      within(cockpit).getByText("Imported document count unavailable"),
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(
      within(cockpit).getByRole("button", { name: "Retry sources" }),
    );
    await waitFor(() =>
      expect(
        within(cockpit).getByText(`confirmation · ${source.label}`),
      ).toBeInTheDocument(),
    );
    expect(
      within(cockpit).queryByText(/Source unavailable/),
    ).not.toBeInTheDocument();
  });

  it("retains an imported file when linking fails and supports a deliberate link retry", async () => {
    const base = createMockGateway();
    let reject = true;
    const gateway = {
      ...base,
      setConciergeProfile: async (
        profile: Parameters<AppGateway["setConciergeProfile"]>[0],
      ) => {
        if (reject)
          throw {
            code: "validation/invalid_input",
            message: "Synthetic link rejection",
          };
        return base.setConciergeProfile(profile);
      },
    };
    const cockpit = await openCockpit(gateway);
    const file = new File(["%PDF-1.4 fixture"], "retained.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(cockpit).getByLabelText("Add PDF or image"), {
      target: { files: [file] },
    });
    expect(
      await within(cockpit).findByText(
        /The file was imported, but its wallet link was not saved/,
      ),
    ).toBeInTheDocument();
    const files = await base.listAttachments("trip_kyoto");
    expect(files).toHaveLength(1);
    expect(
      (await base.getConciergeWorkspace("trip_kyoto")).profile.walletLinks,
    ).toHaveLength(0);
    reject = false;
    fireEvent.change(
      within(cockpit).getByRole("textbox", { name: "Wallet label" }),
      { target: { value: "Retained confirmation" } },
    );
    fireEvent.change(
      within(cockpit).getByRole("combobox", { name: "Imported source" }),
      { target: { value: `attachment:${files[0].id}` } },
    );
    fireEvent.click(
      within(cockpit).getByRole("button", { name: "Add to wallet" }),
    );
    await waitFor(async () =>
      expect(
        (await base.getConciergeWorkspace("trip_kyoto")).profile.walletLinks[0]
          ?.sourceAttachmentId,
      ).toBe(files[0].id),
    );
  });
});
