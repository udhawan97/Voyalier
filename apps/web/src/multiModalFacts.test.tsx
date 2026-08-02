import { fireEvent, screen, within } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { fieldsForType } from "./app/format";
import { renderApp } from "./test/helpers";

/**
 * A confirmation for a train is evidence, exactly as a flight's is (ADR-0016
 * §1). What it is *not* is a booking: nothing here reserves, prices, or checks
 * availability for anything.
 */
describe("surface transport facts", () => {
  it("offers every mode the evidence model records", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));

    const dialog = await screen.findByRole("dialog");
    for (const mode of [
      "Flight",
      "Stay",
      "Train",
      "Coach",
      "Ferry",
      "Hire car",
    ]) {
      expect(
        within(dialog).getByRole("radio", { name: mode }),
      ).toBeInTheDocument();
    }
  });

  it("asks a train for its stations, never for an airport code", () => {
    const rail = fieldsForType("rail_journey");
    expect(rail).toContain("departurePlace");
    expect(rail).toContain("arrivalPlace");
    // The trap this guards: a station is not an IATA code, and offering the
    // field would invite a value the carbon estimate would then read.
    expect(rail).not.toContain("departureAirportIata");
    expect(rail).not.toContain("arrivalAirportIata");
  });

  it("reads a hire car's pickup and drop-off through the journey pair", () => {
    const rental = fieldsForType("car_rental");
    expect(rental).toContain("departureLocal");
    expect(rental).toContain("arrivalLocal");
    expect(rental).toContain("vehicleDescription");
    // A hire car has no scheduled service number.
    expect(rental).not.toContain("serviceNumber");
  });

  it("shows a confirmed rail leg on the trip", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("heading", {
      name: "Kyoto autumn journey",
      level: 1,
    });
    expect(await screen.findAllByText(/Kyoto Station/)).not.toHaveLength(0);
  });
});
