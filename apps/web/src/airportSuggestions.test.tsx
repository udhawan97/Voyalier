import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderApp } from "./test/helpers";

/**
 * The two flight airport fields draw on the bundled offline airport list. The
 * field stores a three-letter code, so the dropdown has to show the airport's
 * name — a list of bare codes is unreadable — and typing that name has to find
 * the airport, because a traveler rarely knows the code by heart.
 */
async function openFlightForm() {
  renderApp();
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add flight or stay" }),
  );
  return screen.findByRole("dialog", { name: "Add a flight or stay" });
}

describe("airport code suggestions", () => {
  it("suggests by code and shows the airport's name beside it", async () => {
    const dialog = await openFlightForm();
    const from = within(dialog).getByLabelText("From (airport)");

    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: "kix" } });

    const listbox = await within(dialog).findByRole("listbox", {
      name: "From (airport) suggestions",
    });
    // The code is the value; the name is what makes the row readable.
    const option = within(listbox).getByRole("option", { name: /KIX/ });
    expect(option).toHaveTextContent("Kansai International Airport");

    fireEvent.keyDown(from, { key: "ArrowDown" });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(from).toHaveValue("KIX");
  });

  it("finds the airport a traveler knows by name but not by code", async () => {
    const dialog = await openFlightForm();
    const to = within(dialog).getByLabelText("To (airport)");

    fireEvent.focus(to);
    fireEvent.change(to, { target: { value: "haneda" } });

    const listbox = await within(dialog).findByRole("listbox", {
      name: "To (airport) suggestions",
    });
    expect(within(listbox).getByRole("option", { name: /HND/ })).toBeVisible();
  });

  it("stays quiet until something is typed", async () => {
    const dialog = await openFlightForm();
    const from = within(dialog).getByLabelText("From (airport)");

    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: "" } });

    await waitFor(() =>
      expect(
        within(dialog).queryByRole("listbox", {
          name: "From (airport) suggestions",
        }),
      ).toBeNull(),
    );
  });
});
