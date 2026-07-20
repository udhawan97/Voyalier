import { fireEvent, screen, within } from "@testing-library/react";
import register from "@voyalier/contracts/parity/data-sources.json";

import { renderSettings } from "./test/helpers";

describe("data source register", () => {
  it("renders the shared, exact source list with license and authority boundaries", async () => {
    await renderSettings();
    const region = screen.getByRole("region", {
      name: "Data sources & licenses",
    });
    fireEvent.click(within(region).getByText("Show all data sources"));
    expect(within(region).getAllByRole("listitem")).toHaveLength(
      register.count,
    );
    expect(
      within(region).getByText("Overture Maps Foundation"),
    ).toBeInTheDocument();
    expect(within(region).getByText("CDLA-Permissive-2.0")).toBeInTheDocument();
    expect(
      within(region).getByText(
        /not routing, access, or opening-hours authority/i,
      ),
    ).toBeInTheDocument();
  });
});
