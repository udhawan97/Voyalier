import { fireEvent, screen, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

async function openKyotoDraft() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Fill gaps with on-device AI" });
}

async function openLisbonDraft() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Lisbon spring draft" }),
  );
  await screen.findByRole("heading", { name: "Lisbon spring draft", level: 1 });
  return screen.findByRole("region", { name: "Fill gaps with on-device AI" });
}

/**
 * The on-device AI draft is Ollama-only, consent-previewed, and review-gated: it
 * reads the trip's own imported text on this device and produces pending
 * candidates the user reviews — never a confirmed fact.
 */
describe("On-device AI lodging draft", () => {
  it("previews the on-device request and drafts a reviewable suggestion", async () => {
    const gateway = createMockGateway();
    // Seed the trip with an imported booking so there is text to read.
    await gateway.importDocument({
      tripId: "trip_kyoto",
      kind: "pasted_text",
      label: "Hotel booking",
      content: "River Paper Inn — check in 2026-11-04, check out 2026-11-12.",
    });
    renderApp(gateway);
    const region = await openKyotoDraft();

    // Preview shows it runs on-device and reveals exactly what it would read.
    fireEvent.click(
      within(region).getByRole("button", { name: "Preview what it reads" }),
    );
    expect(
      await within(region).findByText(/Runs on this device via Ollama/),
    ).toBeInTheDocument();
    expect(within(region).getByText(/River Paper Inn/)).toBeInTheDocument();

    // Running drafts a pending, AI-suggested candidate opened for review.
    fireEvent.click(
      within(region).getByRole("button", { name: "Draft lodging dates" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review suggestions",
    });
    expect(within(dialog).getByText("AI-suggested")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Drafted stay").length).toBeGreaterThan(
      0,
    );
  });

  it("asks you to import a booking when there is nothing to read", async () => {
    // The Lisbon fixture trip has no imported documents.
    renderApp(createMockGateway());
    const region = await openLisbonDraft();

    fireEvent.click(
      within(region).getByRole("button", { name: "Preview what it reads" }),
    );
    expect(
      await within(region).findByText(/Import a booking first/),
    ).toBeInTheDocument();
    // With nothing to read, there is no run affordance.
    expect(
      within(region).queryByRole("button", { name: "Draft lodging dates" }),
    ).toBeNull();
  });

  it("surfaces a validation failure without saving anything", async () => {
    const base = createMockGateway();
    await base.importDocument({
      tripId: "trip_kyoto",
      kind: "pasted_text",
      label: "Hotel booking",
      content: "River Paper Inn stay.",
    });
    const gateway: AppGateway = {
      ...base,
      runAssistDraft: () =>
        Promise.reject({
          code: "assist/failed",
          message:
            "the on-device model's reply didn't match the expected format, so nothing was saved",
        }),
    };
    renderApp(gateway);
    const region = await openKyotoDraft();

    fireEvent.click(
      within(region).getByRole("button", { name: "Preview what it reads" }),
    );
    fireEvent.click(
      await within(region).findByRole("button", {
        name: "Draft lodging dates",
      }),
    );
    expect(
      await within(region).findByText(/couldn't complete the request/),
    ).toBeInTheDocument();
    // No review dialog opened — nothing was drafted.
    expect(
      screen.queryByRole("dialog", { name: "Review suggestions" }),
    ).toBeNull();
  });
});
