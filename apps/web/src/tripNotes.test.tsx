import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, openFixtureTrip, renderApp } from "./test/helpers";

/**
 * Notes sit in a deferred section, so they mount a beat after the trip page and
 * then load. Callers want a usable field, so wait for one rather than for the
 * section shell that appears first.
 */
async function openNotes(gateway?: AppGateway, awaitField = true) {
  renderApp(gateway ?? createMockGateway());
  return openFixtureNotes(awaitField);
}

async function openFixtureNotes(awaitField = true) {
  await openFixtureTrip();
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

/**
 * A note typed inside the debounce window survives leaving the trip.
 *
 * Cancelling the pending save on unmount was safe while every exit went through
 * a control: clicking one blurs the textarea, and blur commits immediately.
 * ADR-0015 removed that guarantee — a browser Back or a phone back-swipe
 * unmounts this panel without ever blurring it, and it turned that gesture into
 * ordinary navigation. The window is under a second, and the loss was silent.
 */
describe("notes and an unmount mid-debounce", () => {
  it("flushes a pending save when the trip view goes away", async () => {
    const saved: string[] = [];
    const gateway = failingGateway({
      setTripNotes: (_tripId: string, body: string) => {
        saved.push(body);
        return Promise.resolve({ tripId: "trip_kyoto", body, updatedAt: null });
      },
    });
    const region = await openNotes(gateway);

    // Typed, but never blurred and never past the debounce.
    fireEvent.change(within(region).getByLabelText("Trip notes"), {
      target: { value: "ryokan deposit due friday" },
    });
    expect(saved).toEqual([]);

    // What Back does: leave the trip without touching a control.
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => expect(saved).toEqual(["ryokan deposit due friday"]));
  });
});

/** Storage completes only when the test releases a request, exposing ordering. */
function deferredNotes() {
  const base = createMockGateway();
  const requests: {
    tripId: string;
    body: string;
    finish: () => Promise<void>;
    fail: () => void;
  }[] = [];
  const gateway: AppGateway = {
    ...base,
    setTripNotes: (tripId, body) =>
      new Promise((resolve, reject) => {
        requests.push({
          tripId,
          body,
          finish: async () => resolve(await base.setTripNotes(tripId, body)),
          fail: () => reject({ code: "transport/failure", message: "down" }),
        });
      }),
  };
  return { base, gateway, requests };
}

function leaveNotes() {
  act(() => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("ordered note persistence", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces blur and debounce behind one write and acknowledges only the durable newest body", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: "Earlier thought" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "Superseded thought" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "Newest thought" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    vi.useRealTimers();
    fireEvent.blur(field);
    // B cannot complete before A: there is no second storage request yet.
    expect(requests.map((request) => request.body)).toEqual([
      "Earlier thought",
    ]);
    await act(async () => {
      await requests[0].finish();
    });
    expect(requests.map((request) => request.body)).toEqual([
      "Earlier thought",
      "Newest thought",
    ]);
    expect(within(notes).queryByText("Saved")).toBeNull();
    expect(field).toHaveValue("Newest thought");
    await act(async () => {
      await requests[1].finish();
    });
    expect(await within(notes).findByText("Saved")).toBeVisible();
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("Newest thought");
    leaveNotes();
    const reopened = within(await openFixtureNotes()).getByLabelText(
      "Trip notes",
    );
    expect(reopened).toHaveValue("Newest thought");
    expect(requests).toHaveLength(2);
  });

  it("persists a clear back to the original empty body after an in-flight save", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "Intermediate thought" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    await act(async () => {
      await requests[0].finish();
    });
    expect(requests.map((request) => request.body)).toEqual([
      "Intermediate thought",
      "",
    ]);
    expect(within(notes).queryByText("Saved")).toBeNull();
    await act(async () => {
      await requests[1].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("");
    expect(await within(notes).findByText("Saved")).toBeVisible();
    leaveNotes();
    const reopened = within(await openFixtureNotes()).getByLabelText(
      "Trip notes",
    );
    expect(reopened).toHaveValue("");
  });

  it("shares the pending writer across navigation/remount without duplicating blur or losing the next edit", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "First draft" } });
    fireEvent.blur(field);
    leaveNotes();
    expect(requests).toHaveLength(1);
    const reopened = within(await openFixtureNotes()).getByLabelText(
      "Trip notes",
    );
    expect(reopened).toHaveValue("First draft");
    fireEvent.change(reopened, { target: { value: "Draft after returning" } });
    leaveNotes(); // flushes before the debounce, while the first save is pending
    expect(requests).toHaveLength(1);
    await act(async () => {
      await requests[0].finish();
    });
    expect(requests.map((request) => request.body)).toEqual([
      "First draft",
      "Draft after returning",
    ]);
    await act(async () => {
      await requests[1].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe(
      "Draft after returning",
    );
  });

  it("retains the latest failed draft for blur retry without an older success acknowledgement", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "A" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "B" } });
    fireEvent.blur(field);
    await act(async () => {
      await requests[0].finish();
    });
    await act(async () => {
      requests[1].fail();
    });
    expect(await within(notes).findByRole("alert")).toBeVisible();
    expect(within(notes).queryByText("Saved")).toBeNull();
    expect(field).toHaveValue("B");
    fireEvent.blur(field);
    expect(requests).toHaveLength(3);
    await act(async () => {
      await requests[2].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("B");
    expect(await within(notes).findByText("Saved")).toBeVisible();
    expect(within(notes).queryByRole("alert")).toBeNull();
  });

  it("continues with the newest desire if an earlier write fails", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "A" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "B" } });
    fireEvent.blur(field);
    expect(requests).toHaveLength(1);
    await act(async () => {
      requests[0].fail();
    });
    expect(requests).toHaveLength(2);
    await act(async () => {
      await requests[1].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("B");
    expect(await within(notes).findByText("Saved")).toBeVisible();
    expect(within(notes).queryByRole("alert")).toBeNull();
  });

  it("keeps writes and drafts isolated when navigating to another trip", async () => {
    const { base, gateway, requests } = deferredNotes();
    const other = await base.createTrip({
      origin: "Paris",
      destination: "Lyon",
      startDate: "2027-04-01",
      endDate: "2027-04-03",
    });
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "Kyoto draft" } });
    fireEvent.blur(field);
    leaveNotes();
    fireEvent.click(
      await screen.findByRole("button", { name: `Open ${other.title}` }),
    );
    await screen.findByRole("heading", { name: other.title, level: 1 });
    const otherNotes = await screen.findByRole("region", { name: "Notes" });
    const otherField = await within(otherNotes).findByLabelText("Trip notes");
    expect(otherField).toHaveValue("");
    fireEvent.change(otherField, { target: { value: "Lyon draft" } });
    fireEvent.blur(otherField);
    expect(requests.map((request) => request.tripId)).toEqual([
      "trip_kyoto",
      other.id,
    ]);
    await act(async () => {
      await requests[1].finish();
      await requests[0].finish();
    });
    expect(otherField).toHaveValue("Lyon draft");
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("Kyoto draft");
    expect((await base.getTripNotes(other.id)).body).toBe("Lyon draft");
  });

  it("retries a clear after a failed response even when the earlier write reached storage", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "Unacknowledged write" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    await base.setTripNotes("trip_kyoto", "Unacknowledged write");
    await act(async () => requests[0].fail());
    expect(requests.map((request) => request.body)).toEqual([
      "Unacknowledged write",
      "",
    ]);
    await act(async () => {
      await requests[1].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe("");
    expect(await within(notes).findByText("Saved")).toBeVisible();
  });

  it("retains a failed pending draft through navigation and retries it without an overlapping write", async () => {
    const { base, gateway, requests } = deferredNotes();
    const notes = await openNotes(gateway);
    const field = within(notes).getByLabelText("Trip notes");
    fireEvent.change(field, { target: { value: "Recoverable thought" } });
    fireEvent.blur(field);
    await act(async () => requests[0].fail());
    expect(await within(notes).findByRole("alert")).toBeVisible();
    leaveNotes();
    expect(requests).toHaveLength(2);
    const reopened = within(await openFixtureNotes()).getByLabelText(
      "Trip notes",
    );
    expect(reopened).toHaveValue("Recoverable thought");
    fireEvent.blur(reopened);
    expect(requests).toHaveLength(2);
    await act(async () => {
      await requests[1].finish();
    });
    expect((await base.getTripNotes("trip_kyoto")).body).toBe(
      "Recoverable thought",
    );
    expect(await screen.findByText("Saved")).toBeVisible();
  });
});
