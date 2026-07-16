import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, renderApp } from "./test/helpers";

/**
 * Notes sit in a deferred section, so they mount a beat after the trip page and
 * then load. Callers want a usable field, so wait for one rather than for the
 * section shell that appears first.
 */
async function openNotes(gateway?: AppGateway, awaitField = true) {
  renderApp(gateway ?? createMockGateway());
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  const region = await screen.findByRole("region", { name: "Notes" });
  if (awaitField) await within(region).findByLabelText("Trip notes");
  return region;
}

/**
 * Free-text notes: the "half-made plans" the README promises a home for. They
 * autosave, they are encrypted at rest, and they never leave the device.
 */
describe("trip notes", () => {
  it("starts empty and saves what you type", async () => {
    const gateway = createMockGateway();
    const region = await openNotes(gateway);
    const field = within(region).getByLabelText("Trip notes");
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: "Book the tea house" } });
    // Leaving the field commits without waiting out the debounce.
    fireEvent.blur(field);

    // The trip page mounts a lot before this settles. The 1s default raced it,
    // and 3s still flaked when the full gate ran lint and builds alongside — so
    // this is generous on purpose. It asserts an eventual state, not a latency.
    expect(
      await screen.findByText("Saved", undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    const stored = await gateway.getTripNotes("trip_kyoto");
    expect(stored.body).toBe("Book the tea house");
    expect(stored.updatedAt).not.toBeNull();
  });

  it("offers no field until the notes have loaded", async () => {
    // Guards the shape that makes a whole class of bug impossible. An earlier
    // version rendered the field before the load landed and hydrated it from an
    // effect — so a keystroke in that window was overwritten when the load
    // arrived. Withholding the field until there is something to edit means
    // there is no window to lose words in.
    const gateway: AppGateway = {
      ...createMockGateway(),
      getTripNotes: () => new Promise(() => {}), // never settles
    };
    const region = await openNotes(gateway, false);
    expect(within(region).queryByLabelText("Trip notes")).toBeNull();
  });

  it("loads notes that were already saved", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Remember the umbrella");

    const region = await openNotes(gateway);
    await waitFor(() =>
      expect(within(region).getByLabelText("Trip notes")).toHaveValue(
        "Remember the umbrella",
      ),
    );
  });

  it("says notes stay out of the brief and away from AI", async () => {
    const region = await openNotes();
    // This is a real guarantee of the design, so it must be on screen — the
    // brief and assist are both built from facts, which notes are not.
    expect(
      within(region).getByText(
        /Never included in a shared brief or sent to an AI provider/,
      ),
    ).toBeInTheDocument();
  });

  it("keeps notes out of the shared brief", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "SECRET-NOTE-TEXT");
    const brief = await gateway.getTripBrief("trip_kyoto");
    // The brief model has no notes field at all; assert the text cannot appear.
    expect(JSON.stringify(brief)).not.toContain("SECRET-NOTE-TEXT");
  });

  it("keeps notes out of an AI request preview", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "SECRET-NOTE-TEXT");
    const preview = await gateway.previewAssist("trip_kyoto", "ollama");
    expect(JSON.stringify(preview)).not.toContain("SECRET-NOTE-TEXT");
  });

  it("clearing the field removes the notes rather than storing blank", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Temporary");

    const region = await openNotes(gateway);
    const field = within(region).getByLabelText("Trip notes");
    await waitFor(() => expect(field).toHaveValue("Temporary"));

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    await waitFor(async () => {
      const stored = await gateway.getTripNotes("trip_kyoto");
      expect(stored.body).toBe("");
      // Cleared is the same state as never-written: one state, not two.
      expect(stored.updatedAt).toBeNull();
    });
  });

  it("says so when a save fails, and keeps the text on screen", async () => {
    const region = await openNotes(
      failingGateway({
        setTripNotes: () =>
          Promise.reject({ code: "transport/failure", message: "down" }),
      }),
    );
    const field = within(region).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "Unsaved thought" } });
    fireEvent.blur(field);

    expect(await within(region).findByRole("alert")).toBeInTheDocument();
    // The words the traveler typed are still there — losing them would be worse
    // than the failed save.
    expect(field).toHaveValue("Unsaved thought");
  });
});
