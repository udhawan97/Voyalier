import { expect, test } from "@playwright/test";

function isoDay(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("Create Trip returns focus to its exact opener", async ({ page }) => {
  let showEmptyState = true;
  await page.route("**/api/v1/trips", async (route) => {
    if (showEmptyState && route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  const openers = page.getByRole("button", { name: "Create a trip" });
  await expect(openers).toHaveCount(2);
  const headerOpener = openers.first();
  const emptyStateOpener = openers.last();

  await headerOpener.click();
  const dialog = page.getByRole("dialog", { name: "Create a trip" });
  await expect(dialog.getByLabel("From")).toBeFocused();
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(headerOpener).toBeFocused();

  await headerOpener.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(headerOpener).toBeFocused();

  await emptyStateOpener.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(emptyStateOpener).toBeFocused();

  await emptyStateOpener.click();
  await dialog.getByLabel("From").fill("Chicago");
  await dialog.getByLabel("To").fill("Kyoto");
  await dialog.getByLabel("Start date").fill(isoDay(30));
  await dialog.getByLabel("End date").fill(isoDay(37));
  await dialog
    .getByLabel("Trip name (optional)")
    .fill(`Focus fallback ${test.info().project.name}`);
  showEmptyState = false;
  await dialog.getByRole("button", { name: "Create trip" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Trips", level: 1 }),
  ).toBeFocused();
});

test("the planning register stays inside a 320px viewport after search focus", async ({
  browserName,
  page,
}) => {
  const tripTitle = `Narrow ${browserName} retry ${test.info().retry} trip`;
  const itemTitle = `Museum transfer ${browserName}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Create a trip" }).first().click();
  const createTrip = page.getByRole("dialog", { name: "Create a trip" });
  await createTrip.getByLabel("From").fill("Chicago");
  await createTrip.getByLabel("To").fill("Kyoto");
  await createTrip.getByLabel("Start date").fill(isoDay(30));
  await createTrip.getByLabel("End date").fill(isoDay(37));
  await createTrip.getByLabel("Trip name (optional)").fill(tripTitle);
  await createTrip.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: `Open ${tripTitle}` }).click();
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 720 });

  const planning = page.locator(".voy-planning");
  await expect(planning).toBeVisible();
  const initialGeometry = await planning.evaluate((grid) => {
    const viewportWidth = document.documentElement.clientWidth;
    const parent = grid.parentElement!.getBoundingClientRect();
    const own = grid.getBoundingClientRect();
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      parentRight: parent.right,
      gridRight: own.right,
      widestSectionRight: Math.max(
        ...Array.from(
          grid.children,
          (child) => child.getBoundingClientRect().right,
        ),
      ),
      overflowingElements: Array.from(document.querySelectorAll("*"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element: [
              element.tagName.toLowerCase(),
              element.id ? `#${element.id}` : "",
              ...Array.from(element.classList, (name) => `.${name}`),
            ].join(""),
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
            parent: element.parentElement
              ? [
                  element.parentElement.tagName.toLowerCase(),
                  ...Array.from(
                    element.parentElement.classList,
                    (name) => `.${name}`,
                  ),
                ].join("")
              : null,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowX: getComputedStyle(element).overflowX,
          };
        })
        .filter(
          ({ left, right }) => left < -0.01 || right > viewportWidth + 0.01,
        )
        .sort((a, b) => b.right - a.right)
        .slice(0, 20),
    };
  });
  expect(
    initialGeometry.documentWidth,
    JSON.stringify(initialGeometry, null, 2),
  ).toBeLessThanOrEqual(initialGeometry.viewportWidth);
  expect(initialGeometry.gridRight).toBeLessThanOrEqual(
    initialGeometry.parentRight + 1,
  );
  expect(initialGeometry.widestSectionRight).toBeLessThanOrEqual(
    initialGeometry.parentRight + 1,
  );

  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByLabel("Name").fill(itemTitle);
  await plans.getByRole("button", { name: "Add to plan" }).click();
  await expect(plans.getByText(itemTitle, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search all trips").fill(itemTitle);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(itemTitle) }).click();

  const target = page
    .locator('[data-search-source="trip_item"]')
    .filter({ hasText: itemTitle });
  await expect(target).toBeFocused();
  const focusedGeometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      scrollX: window.scrollX,
    };
  });
  expect(focusedGeometry.scrollX).toBe(0);
  expect(focusedGeometry.left).toBeGreaterThanOrEqual(0);
  expect(focusedGeometry.right).toBeLessThanOrEqual(
    focusedGeometry.viewportWidth,
  );
});
