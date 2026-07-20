import { fireEvent, screen } from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

describe("workspace search", () => {
  it("finds local records across trips and opens the owning trip", async () => {
    renderApp(createMockGateway());
    fireEvent.click(
      await screen.findByRole("button", { name: "Search workspace" }),
    );
    await screen.findByRole("heading", { name: "Search workspace" });

    fireEvent.change(screen.getByLabelText("Search all trips"), {
      target: { value: "Maple Lantern" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Kyoto autumn journey")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Kyoto confirmations/i }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Kyoto autumn journey",
        level: 1,
      }),
    ).toBeInTheDocument();
  });
});
