import { expect, test } from "@playwright/test";

function isoDay(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("planning persists through the real loopback service and a browser reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Trips", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create a trip" }).first().click();
  const createTrip = page.getByRole("dialog", { name: "Create a trip" });
  await createTrip.getByLabel("From").fill("Chicago");
  await createTrip.getByLabel("To").fill("Paris");
  await createTrip.getByLabel("Start date").fill(isoDay(-1));
  await createTrip.getByLabel("End date").fill(isoDay(1));
  await createTrip
    .getByLabel("Trip name (optional)")
    .fill("Loopback release trip");
  await createTrip.getByRole("button", { name: "Create trip" }).click();
  await page
    .getByRole("button", { name: "Open Loopback release trip" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Loopback release trip", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  const packing = page.getByRole("region", { name: "Packing checklist" });
  await packing.getByLabel("Custom item").fill("Museum pass");
  await packing.getByRole("button", { name: "Add", exact: true }).click();
  await packing.getByRole("checkbox", { name: "Museum pass" }).click();
  await expect(
    packing.getByRole("checkbox", { name: "Museum pass" }),
  ).toBeChecked();

  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByLabel("Name").fill("Tea ceremony");
  await plans.getByLabel("Location (optional)").fill("Left Bank");
  await plans.getByLabel("Start (optional)").fill(`${isoDay(0)}T12:00`);
  await plans.getByRole("button", { name: "Add to plan" }).click();
  await expect(plans.getByText("Tea ceremony")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Today" }).getByText(/Tea ceremony/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search all trips").fill("Tea ceremony");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Tea ceremony.*Loopback release trip/,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Data sources & licenses" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.setViewportSize({ width: 640, height: 720 });
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tus viajes", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page
    .getByRole("button", { name: "Abrir Loopback release trip" })
    .click();
  await expect(page.getByText("Museum pass")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Actividades y traslados" })
      .getByText("Tea ceremony", { exact: true }),
  ).toBeVisible();
});
