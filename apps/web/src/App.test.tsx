import { render, screen } from "@testing-library/react";

import { App } from "./App";

describe("App", () => {
  it("shows the product contract and connected local service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          service: "voyalier-server",
          version: "0.1.0",
          intelligence_mode: "local",
        }),
      }),
    );

    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /from scattered plans to one clear journey/i,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Local core ready")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Blueprint" }),
    ).toBeInTheDocument();
  });
});
