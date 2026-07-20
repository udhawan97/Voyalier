import { expect, test } from "@playwright/test";

test("traveler planning, workspace search, and locale work in a real browser", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Kyoto autumn journey" }).click();
  await expect(
    page.getByRole("heading", { name: "Kyoto autumn journey", level: 1 }),
  ).toBeVisible();

  const packing = page.getByRole("region", { name: "Packing checklist" });
  await packing.getByLabel("Custom item").fill("Museum pass");
  await packing.getByRole("button", { name: "Add", exact: true }).click();
  await packing.getByRole("checkbox", { name: "Museum pass" }).check();
  await expect(
    packing.getByRole("checkbox", { name: "Museum pass" }),
  ).toBeChecked();

  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByLabel("Name").fill("Tea ceremony");
  await plans.getByLabel("Location (optional)").fill("Gion");
  await plans.getByRole("button", { name: "Add to plan" }).click();
  await expect(plans.getByText("Tea ceremony")).toBeVisible();

  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search all trips").fill("Maple Lantern");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Kyoto autumn journey")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Fuentes de datos y licencias")).toBeVisible();
});
