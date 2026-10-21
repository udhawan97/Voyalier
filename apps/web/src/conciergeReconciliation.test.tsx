import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway, type AppGateway } from "@voyalier/contracts";

import { findA11yViolations, renderTrip } from "./test/helpers";

async function retainedSetup() {
  const base = createMockGateway();
  const initial = (await base.getConciergeWorkspace("trip_kyoto")).profile;
  await base.setConciergeProfile({
    ...initial,
    travelers: [
      { id: "person", displayName: "Me", residenceStatus: "unknown" },
    ],
    walletLinks: [
      {
        id: "wallet",
        label: "Accepted document",
        category: "entry",
        travelerIds: ["person"],
        note: "Local note",
      },
    ],
    costs: [
      {
        id: "cost",
        label: "Accepted estimate",
        category: "transport",
        amountMinor: 1200,
        currency: "USD",
        state: "estimate",
      },
    ],
    providerHandoffs: [
      {
        id: "handoff",
        providerActionId: "stays-airbnb",
        provider: "Airbnb",
        url: "https://www.airbnb.com/",
        searchBrief: "Accepted brief",
        openedAt: "2026-10-21T12:00:00Z",
        state: "saved",
      },
    ],
    taskProgress: [
      { taskId: "review-entry", state: "waiting", note: "Accepted progress" },
    ],
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
  await renderTrip({ ...base, setConciergeProfile });
  const cockpit = (
    await screen.findByRole("heading", {
      name: "Everything between here and there",
    })
  ).closest("section")!;
  const bedrooms = within(cockpit).getByRole("spinbutton", {
    name: "Bedrooms",
  });
  const save = () =>
    within(cockpit).getByRole("button", { name: "Save setup" });
  fireEvent.change(bedrooms, { target: { value: "2" } });
  fireEvent.click(save());
  fireEvent.change(bedrooms, { target: { value: "3" } });
  await act(async () => {
    release();
    await gate;
  });
  await waitFor(() => expect(save()).not.toBeDisabled());
  const accepted = (await base.getConciergeWorkspace("trip_kyoto")).profile;
  const reviewButton = () =>
    within(cockpit).getByRole("button", { name: "Review setup changes" });
  async function review() {
    reviewButton().focus();
    fireEvent.click(reviewButton());
    return screen.findByRole("dialog", { name: "Review setup changes" });
  }
  return {
    base,
    cockpit,
    bedrooms,
    save,
    setConciergeProfile,
    accepted,
    review,
    reviewButton,
  };
}

it("reviews and reapplies retained setup without dispatching or merging other state", async () => {
  const { base, bedrooms, save, setConciergeProfile, accepted, review } =
    await retainedSetup();
  const dialog = await review();
  expect(dialog).toHaveAttribute("lang", "en");
  const row = within(dialog).getByText("Bedrooms").closest("div")!;
  expect(row).toHaveTextContent("Saved: 2");
  expect(row).toHaveTextContent("Your choice: 3");
  expect(await findA11yViolations()).toEqual([]);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Keep my setup choices" }),
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(bedrooms).toHaveValue(3);
  expect(save()).toHaveFocus();
  expect(setConciergeProfile).toHaveBeenCalledTimes(1);
  fireEvent.click(save());
  await waitFor(() => expect(save()).not.toBeDisabled());
  expect(setConciergeProfile).toHaveBeenCalledTimes(2);
  const submitted = setConciergeProfile.mock.calls[1][0];
  expect(submitted).toEqual({
    ...accepted,
    preferences: { ...accepted.preferences, bedrooms: 3 },
  });
  expect(
    (await base.getConciergeWorkspace("trip_kyoto")).profile.preferences
      .bedrooms,
  ).toBe(3);
});

it("cancelling review retains the draft and restores its exact opener", async () => {
  const { bedrooms, setConciergeProfile, review, reviewButton } =
    await retainedSetup();
  const dialog = await review();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(bedrooms).toHaveValue(3);
  expect(reviewButton()).toHaveFocus();
  expect(setConciergeProfile).toHaveBeenCalledTimes(1);
});

it("reviews authored setup text verbatim and formats a budget as money", async () => {
  const { cockpit, review } = await retainedSetup();
  fireEvent.change(within(cockpit).getByLabelText("Island or neighborhood"), {
    target: { value: "open" },
  });
  const budget = within(cockpit).getByLabelText("Budget from");
  fireEvent.change(budget, { target: { value: "12.50" } });
  fireEvent.blur(budget);
  const dialog = await review();
  expect(
    within(dialog).getByText("Island or neighborhood").closest("div"),
  ).toHaveTextContent("Your choice: open");
  expect(
    within(dialog).getByText("Budget from").closest("div"),
  ).toHaveTextContent("12.50");
});

it("a later independent write still refuses the reconciled CAS save", async () => {
  const { base, cockpit, bedrooms, save, accepted, review } =
    await retainedSetup();
  const dialog = await review();
  const changed = await base.setConciergeProfile({
    ...accepted,
    costs: [
      ...accepted.costs,
      {
        id: "later",
        label: "Later estimate",
        category: "transport",
        currency: "USD",
        state: "estimate",
      },
    ],
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Keep my setup choices" }),
  );
  fireEvent.click(save());
  await within(cockpit).findByRole("button", { name: "Reload saved profile" });
  expect((await base.getConciergeWorkspace("trip_kyoto")).profile).toEqual(
    changed.profile,
  );
  expect(bedrooms).toHaveValue(3);
});

it("invalidates an open review when a refreshed baseline arrives", async () => {
  const { base, cockpit, bedrooms, save, accepted, review } =
    await retainedSetup();
  // The retained draft still fails closed before explicit reconciliation.
  fireEvent.click(save());
  const reload = await within(cockpit).findByRole("button", {
    name: "Reload saved profile",
  });
  const dialog = await review();
  await base.setConciergeProfile({
    ...accepted,
    preferences: { ...accepted.preferences, bedrooms: 4 },
  });
  fireEvent.click(reload);
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Keep my setup choices" }),
    ).toBeDisabled(),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "saved profile or your draft changed",
  );
  expect(bedrooms).toHaveValue(3);
});

it("invalidates an open review when the draft generation changes", async () => {
  const { bedrooms, setConciergeProfile, review } = await retainedSetup();
  const dialog = await review();
  fireEvent.change(bedrooms, { target: { value: "5" } });
  expect(
    within(dialog).getByRole("button", { name: "Keep my setup choices" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "saved profile or your draft changed",
  );
  expect(setConciergeProfile).toHaveBeenCalledTimes(1);
  expect(bedrooms).toHaveValue(5);
});
