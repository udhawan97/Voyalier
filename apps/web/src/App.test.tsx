import { render, screen } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { App } from "./App";

describe("App shell", () => {
  it("renders the trip workspace with the seeded trips", async () => {
    render(<App gateway={createMockGateway()} />);

    expect(
      screen.getByRole("heading", { name: "Trips", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Voyalier — all trips")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Color theme" }),
    ).toBeInTheDocument();

    // Seeded fixtures load through the injected mock gateway.
    expect(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Local core ready")).toBeInTheDocument();
  });
});
