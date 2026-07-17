import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * Origin/destination autocomplete is backed by the offline gazetteer: typing a
 * city prefix surfaces world cities (with their country) without any network
 * geocoding. Free text always still works.
 */
describe("place autocomplete", () => {
  async function openCreateTrip() {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a trip" }),
    );
    return screen.findByRole("dialog");
  }

  it("suggests gazetteer cities for a typed prefix", async () => {
    const dialog = await openCreateTrip();
    const destination = within(dialog).getByLabelText("To");
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "osa" } });

    // "Osaka" comes from the offline gazetteer, labelled with its country.
    const option = await within(dialog).findByRole("option", { name: /Osaka/ });
    expect(option).toHaveTextContent(/Japan/);
  });

  it("still accepts free text that matches no city", async () => {
    const dialog = await openCreateTrip();
    const destination = within(dialog).getByLabelText("To") as HTMLInputElement;
    fireEvent.change(destination, {
      target: { value: "My Secret Cabin" },
    });
    await waitFor(() => expect(destination.value).toBe("My Secret Cabin"));
  });
});
