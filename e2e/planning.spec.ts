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
  await expect(
    packing.getByRole("button", { name: "Add", exact: true }).last(),
  ).toBeDisabled();
  await packing.getByLabel("Custom item").fill("Museum pass");
  await packing.getByRole("button", { name: "Add", exact: true }).click();
  await packing.getByRole("checkbox", { name: "Museum pass" }).click();
  await expect(
    packing.getByRole("checkbox", { name: "Museum pass" }),
  ).toBeChecked();

  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByRole("button", { name: "Add to plan" }).click();
  await expect(
    plans.getByText("Enter a name before adding this plan."),
  ).toBeVisible();
  await expect(plans.getByLabel("Name")).toBeFocused();
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
  const result = page.getByRole("button", {
    name: /Tea ceremony.*Loopback release trip/,
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole("heading", { name: "Loopback release trip", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(/#section-plan$/);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Data sources & licenses" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const themeGroups = page.getByRole("radiogroup", {
    name: "Tema de color",
  });
  await expect(themeGroups).toHaveCount(2);
  await themeGroups.first().getByRole("radio", { name: "Oscuro" }).click();
  await expect(
    themeGroups.last().getByRole("radio", { name: "Oscuro" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Buscar en el espacio de trabajo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configuración" }),
  ).toBeVisible();
  await expect(page.locator(".voy-health")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // Since ADR-0015 the URL is what a reload restores, and this reload happens
  // while Settings is open — so Settings is what comes back, which is the
  // point. Going back to the trip first keeps this assertion about what it was
  // always about: that the trip's own planning data survived the round trip.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Configuración", level: 1 }),
  ).toBeVisible();
  await page.goBack();

  await expect(
    page.getByRole("heading", { name: "Loopback release trip", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page).toHaveURL(/#section-plan$/);
  await expect
    .poll(() =>
      page.locator("#section-plan").evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        return top >= -1 && top < 240;
      }),
    )
    .toBe(true);
  await expect(page.getByText("Museum pass")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Actividades y traslados" })
      .getByText("Tea ceremony", { exact: true }),
  ).toBeVisible();
});

/**
 * The passport row is one row.
 *
 * This lives here, and not in the unit suite, because jsdom performs no layout:
 * it reports every element as zero-sized, so the defect this guards against —
 * `flex: 1 1 16rem` landing on a column-axis child and computing a 44px input
 * as 256px tall — is invisible to Vitest by construction. Only a real engine
 * can fail this test.
 */
test("the visa passport field keeps its Save button and suggestions attached", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a trip" }).first().click();
  const createTrip = page.getByRole("dialog", { name: "Create a trip" });
  await createTrip.getByLabel("From").fill("Mumbai");
  await createTrip.getByLabel("To").fill("Tokyo");
  await createTrip.getByLabel("Start date").fill(isoDay(30));
  await createTrip.getByLabel("End date").fill(isoDay(44));
  await createTrip.getByLabel("Trip name (optional)").fill("Passport row trip");
  await createTrip.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: "Open Passport row trip" }).click();
  await page.getByRole("link", { name: "Visa" }).click();

  const row = page.locator(".voy-visa__nationality");
  await expect(row.locator("input")).toBeVisible();

  // Both viewports: the row wraps below 48rem, so the desktop and narrow cases
  // are genuinely different layouts rather than the same one measured twice.
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const gap = await row.evaluate((form) => {
      const input = form.querySelector("input") as HTMLElement;
      const save = form.querySelector(".voy-btn") as HTMLElement;
      const inputBox = input.getBoundingClientRect();
      const saveBox = save.getBoundingClientRect();
      return {
        // The wrapper must not inflate around its own 44px input.
        wrapperHeight: Math.round(
          (
            form.querySelector(".voy-field") as HTMLElement
          ).getBoundingClientRect().height,
        ),
        inputHeight: Math.round(inputBox.height),
        saveBelowInput: Math.round(saveBox.top - inputBox.bottom),
      };
    });
    expect(gap.wrapperHeight).toBeLessThan(gap.inputHeight * 3);
    expect(gap.saveBelowInput).toBeLessThan(gap.inputHeight);
  }

  // The suggestion list hangs off the combobox box, so an inflated wrapper
  // detaches it from the input it belongs to.
  await page.setViewportSize({ width: 1280, height: 900 });
  // "Ind" also matches the British Indian Ocean Territory and Indonesia, so
  // name the one the ranking puts first rather than the substring.
  await row.locator("input").fill("Ind");
  await expect(page.getByRole("option", { name: "India — IN" })).toBeVisible();
  const listOffset = await row.evaluate((form) => {
    const input = form.querySelector("input") as HTMLElement;
    const list = form.querySelector(".voy-combobox__list") as HTMLElement;
    return Math.round(
      list.getBoundingClientRect().top - input.getBoundingClientRect().bottom,
    );
  });
  expect(listOffset).toBeLessThan(12);
});
