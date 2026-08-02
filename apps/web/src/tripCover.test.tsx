import { hueFor } from "./views/TripCover";

/**
 * The cover's colour is derived, not fetched.
 *
 * That is the whole reason it exists in this form: a photograph would mean a new
 * source, a new licence, and a new consent for decoration (ADR-0016 and the
 * component's own note). A derived hue has to be stable and well spread instead.
 */
describe("trip cover", () => {
  it("gives the same destination the same colour every time", () => {
    expect(hueFor("Kyoto")).toBe(hueFor("Kyoto"));
    // Whitespace and case are presentation, not identity.
    expect(hueFor("  kyoto ")).toBe(hueFor("Kyoto"));
  });

  it("separates the destinations a workspace actually holds", () => {
    const cities = [
      "Kyoto",
      "Reykjavík",
      "Lisbon",
      "Nashville",
      "Paris",
      "Tokyo",
      "Chicago",
      "Naxos",
    ];
    const hues = cities.map(hueFor);
    expect(new Set(hues).size).toBe(cities.length);
  });

  it("stays inside the colour wheel", () => {
    for (const city of ["", "A", "a very long destination name indeed"]) {
      const hue = hueFor(city);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
