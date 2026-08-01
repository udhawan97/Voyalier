import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, renderApp } from "./test/helpers";

const REPLY = /Working from your saved plans and research on this device/;

async function openChat(gateway?: AppGateway) {
  renderApp(gateway ?? createMockGateway());
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Ask about this trip" });
}

/** Wait for the composer (the thread loads first), then send a message. */
async function ask(region: HTMLElement, message: string) {
  const field = await within(region).findByLabelText("Your message");
  fireEvent.change(field, { target: { value: message } });
  fireEvent.click(within(region).getByRole("button", { name: "Send" }));
}

/**
 * An on-device conversation about one trip. Local by construction, grounded in
 * the trip's own saved material, and never the authority on anything that
 * matters — which the interface says for itself, above the model's own words.
 */
describe("trip chat", () => {
  it("renders both turns of an exchange", async () => {
    const region = await openChat();

    await ask(region, "What should I pack for the evenings?");

    const thread = await within(region).findByRole("list", {
      name: "Conversation",
    });
    expect(
      await within(thread).findByText("What should I pack for the evenings?"),
    ).toBeInTheDocument();
    expect(await within(thread).findByText(REPLY)).toBeInTheDocument();
    // The two turns are told apart, not run together as one transcript.
    expect(within(thread).getByText("You")).toBeInTheDocument();
    expect(within(thread).getByText("On-device AI")).toBeInTheDocument();
  });

  it("cites what a reply was grounded in", async () => {
    const gateway = createMockGateway();
    // Grounding is the trip's own kept research, so there has to be some.
    await gateway.createResource({
      tripId: "trip_kyoto",
      kind: "link",
      url: "https://example.com/kyoto-guide",
      title: "Kyoto guide",
    });
    const region = await openChat(gateway);

    await ask(region, "What should I read first?");

    expect(
      await within(region).findByText(/Grounded on: Kyoto guide/),
    ).toBeInTheDocument();
    // And how much of the confirmed itinerary formed the baseline, counted.
    expect(within(region).getByText(/confirmed plans/)).toBeInTheDocument();
  });

  it("says nothing about grounding when there is nothing to cite", async () => {
    const gateway = createMockGateway();
    // A fresh trip: no kept research and no confirmed facts, so an empty
    // "Grounded on:" would be a claim about the trip rather than the answer.
    const trip = await gateway.createTrip({
      origin: "Chicago",
      destination: "Lisbon",
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    const reply = await gateway.sendChatMessage(
      trip.id,
      "Where should I walk?",
    );

    expect(reply.grounding).toEqual([]);
    expect(reply.itineraryFacts).toBe(0);
  });

  it("answers a high-stakes question with its own pointer AND the reply", async () => {
    const region = await openChat();

    await ask(region, "Do I need a visa for this trip?");

    // Voyalier states where the authority actually lives...
    expect(
      await within(region).findByText(
        "Entry rules: Voyalier isn't the authority",
      ),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/visa preparation panel walks the steps/),
    ).toBeInTheDocument();
    // ...and still prints what the model said. Suppressing the reply would be
    // its own kind of claim.
    expect(within(region).getByText(REPLY)).toBeInTheDocument();
  });

  /**
   * The question above says "visa", which was one of the twenty words the mock's
   * hand-written copy of the table happened to share with the core's forty-eight.
   * These are two it did not: a multi-word form the copy had no scan for at all,
   * and a single word added to the core after the copy was written. Both raise
   * the pointer in the shipped product, and neither did in mock mode.
   */
  it.each([
    [
      "a phrase no single-word scan would catch",
      "What are the entry requirements for Japan?",
      "Entry rules: Voyalier isn't the authority",
    ],
    [
      "a word added to the table later",
      "Do I need to worry about quarantine?",
      "Health: Voyalier isn't the authority",
    ],
  ])("raises the pointer for %s", async (_name, question, title) => {
    const region = await openChat();

    await ask(region, question);

    expect(await within(region).findAllByText(title)).not.toHaveLength(0);
    expect(within(region).getByText(REPLY)).toBeInTheDocument();
  });

  it("explains instead of offering an input when no local model is running", async () => {
    const region = await openChat(
      failingGateway({
        detectLocalAi: () =>
          Promise.resolve({
            provider: "ollama" as const,
            available: false,
            models: [],
          }),
      }),
    );

    expect(
      await within(region).findByText("Chat needs a model on this computer"),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/Install Ollama, pull a model/),
    ).toBeInTheDocument();
    expect(within(region).queryByLabelText("Your message")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("keeps a reply by appending it to the trip's notes", async () => {
    const gateway = createMockGateway();
    await gateway.setTripNotes("trip_kyoto", "Existing thought");
    const region = await openChat(gateway);

    await ask(region, "What should I do on the first morning?");
    await within(region).findByText(REPLY);
    fireEvent.click(
      within(region).getByRole("button", { name: "Save to notes" }),
    );

    await waitFor(async () => {
      const notes = await gateway.getTripNotes("trip_kyoto");
      expect(notes.body).toContain("Existing thought");
      expect(notes.body).toContain("Working from your saved plans");
    });
  });

  it("clears the conversation behind a confirm", async () => {
    const gateway = createMockGateway();
    const region = await openChat(gateway);
    await ask(region, "Anything to know about the trains?");
    await within(region).findByText(REPLY);

    const clear = within(region).getByRole("button", {
      name: "Clear conversation",
    });
    fireEvent.click(clear);
    // Armed, not fired: one stray click must not erase the thread.
    expect(await gateway.listChatMessages("trip_kyoto")).not.toHaveLength(0);
    fireEvent.click(
      within(region).getByRole("button", { name: /Clear conversation/ }),
    );

    await waitFor(async () =>
      expect(await gateway.listChatMessages("trip_kyoto")).toHaveLength(0),
    );
  });

  it("refuses a message longer than the store can hold", async () => {
    const region = await openChat();

    fireEvent.change(await within(region).findByLabelText("Your message"), {
      // Astral characters: 4,001 of them, which `.length` would count as 8,002
      // and a naive limit would reject at half the real allowance.
      target: { value: "😀".repeat(4001) },
    });

    expect(await within(region).findByRole("alert")).toHaveTextContent(
      /longer than Voyalier can send/,
    );
    expect(within(region).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("says what it can read and what is deliberately withheld", async () => {
    const region = await openChat();

    const guidance = within(region).getByText(/This chat runs on this machine/);
    expect(guidance).toHaveTextContent(
      /confirmation codes and traveler names are deliberately withheld/,
    );
    expect(guidance).toHaveTextContent(/can't tell you your booking reference/);
    // The standing position on model output, which is not dismissible.
    expect(
      within(region).getByText(/AI-generated and never authoritative/),
    ).toBeInTheDocument();
  });
});
