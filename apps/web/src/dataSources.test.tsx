import { fireEvent, screen, within } from "@testing-library/react";
import register from "@voyalier/contracts/parity/data-sources.json";

import { renderSettings } from "./test/helpers";
import { OPENFREEMAP_STYLE_URL } from "./views/MapPanel";

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
      within(region).getByRole("heading", { name: "Built into the app" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { name: "Fetched with consent" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { name: "Offline downloads" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { name: "Optional AI" }),
    ).toBeInTheDocument();
    expect(within(region).getAllByRole("link")).toHaveLength(register.count);
    expect(new Set(register.sources.map((source) => source.id))).toEqual(
      new Set([
        "uk-fcdo",
        "us-state",
        "ca-gac",
        "de-aa",
        "us-cdc",
        "open-meteo",
        "nws",
        "ecb",
        "nager-date",
        "wikimedia",
        "openfreemap",
        "overture",
        "wikivoyage",
        "protomaps-osm",
        "geonames",
        "ourairports",
        "wikidata-heritage",
        "ollama",
        "openai",
        "anthropic",
      ]),
    );
    expect(
      register.sources.find((source) => source.id === "openfreemap")?.endpoint,
    ).toBe(OPENFREEMAP_STYLE_URL);
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
