import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderSettings } from "./test/helpers";

async function openPromptSettings() {
  return screen.findByRole("region", { name: "Customize AI instructions" });
}

/**
 * The AI instructions are editable in settings: each shows its default, you can
 * override it, and Reset restores the built-in default. Overrides live on-device.
 */
describe("Editable AI instructions", () => {
  it("overrides an instruction and resets it to default", async () => {
    await renderSettings(createMockGateway());
    const region = await openPromptSettings();

    const assist = await within(region).findByLabelText(
      "Assist & preview instruction",
    );
    const row = assist.closest(".voy-prompt") as HTMLElement;
    expect(within(row).getByText("Default")).toBeInTheDocument();

    // Override it → the row is marked Customized.
    fireEvent.change(assist, { target: { value: "Only answer in haiku." } });
    fireEvent.click(
      within(row).getByRole("button", { name: "Save instruction" }),
    );
    expect(await within(row).findByText("Customized")).toBeInTheDocument();

    // Reset → back to Default.
    fireEvent.click(
      within(row).getByRole("button", { name: "Reset to default" }),
    );
    expect(await within(row).findByText("Default")).toBeInTheDocument();
  });

  it("carries a saved override into the draft preview", async () => {
    const gateway = createMockGateway();
    await gateway.importDocument({
      tripId: "trip_kyoto",
      kind: "pasted_text",
      label: "Hotel booking",
      content: "River Paper Inn stay.",
    });
    await renderSettings(gateway);
    const region = await openPromptSettings();

    const draft = await within(region).findByLabelText(
      "Lodging-date draft instruction",
    );
    const row = draft.closest(".voy-prompt") as HTMLElement;
    fireEvent.change(draft, {
      target: { value: "CUSTOM-DRAFT-INSTRUCTION" },
    });
    fireEvent.click(
      within(row).getByRole("button", { name: "Save instruction" }),
    );
    await within(row).findByText("Customized");

    // The instruction is saved in Settings but spent on a trip, so walk the
    // route a user walks: back out of Settings, then open the trip.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );

    // The draft preview now shows the custom instruction.
    const draftRegion = await screen.findByRole("region", {
      name: "Fill gaps with on-device AI",
    });
    fireEvent.click(
      within(draftRegion).getByRole("button", {
        name: "Preview what it reads",
      }),
    );
    expect(
      await within(draftRegion).findByText(/CUSTOM-DRAFT-INSTRUCTION/),
    ).toBeInTheDocument();
  });
});
