import { expect, test, type Page } from "@playwright/test";

function isoDay(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Model desktop browser zoom: keep the same physical surface, halve the CSS
 * viewport, and double device pixels. Unlike page-scale/pinch emulation, this
 * makes media queries and layout reflow at the effective zoomed width.
 */
async function emulateDesktopZoom(
  page: Page,
  viewport: { width: number; height: number },
  factor: number,
) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: Math.ceil(viewport.width / factor),
    height: Math.ceil(viewport.height / factor),
    deviceScaleFactor: factor,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  return session;
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
  const searchInput = page.getByLabel("Search all trips");
  const searchButton = page.getByRole("button", {
    name: "Search",
    exact: true,
  });
  const emptySearchHint = page.getByText(
    "Enter a search term to enable Search.",
  );
  await expect(searchButton).toBeDisabled();
  await expect(emptySearchHint).toBeVisible();
  await expect(searchInput).toHaveAttribute(
    "aria-describedby",
    await emptySearchHint.getAttribute("id"),
  );
  await searchInput.fill("   ");
  await expect(searchButton).toBeDisabled();

  // A valid query still works through an explicit pointer action.
  await searchInput.fill("Tea ceremony");
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(
    page.getByRole("button", { name: /Tea ceremony.*Loopback release trip/ }),
  ).toBeVisible();

  // And form Enter runs the trimmed replacement query.
  await searchInput.fill("  Left Bank  ");
  await searchInput.press("Enter");
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
  await expect(
    page.getByText(
      /versión desde código fuente en el navegador sigue guardando tu espacio de trabajo en SQLite local/i,
    ),
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

  await page
    .getByRole("button", { name: "Buscar en el espacio de trabajo" })
    .click();
  const spanishInput = page.getByLabel("Buscar en todos los viajes");
  const spanishHint = page.getByText(
    "Escribe un término de búsqueda para activar Buscar.",
  );
  await expect(
    page.getByRole("button", { name: "Buscar", exact: true }),
  ).toBeDisabled();
  await expect(spanishHint).toBeVisible();
  await expect(spanishInput).toHaveAttribute(
    "aria-describedby",
    await spanishHint.getAttribute("id"),
  );

  // Exercise 200%-equivalent desktop zoom reflow: a 320×360 CSS viewport on
  // a 640×720 physical surface, with two device pixels per CSS pixel. This is
  // the app's supported 320px minimum layout width under desktop zoom.
  await page.setViewportSize({ width: 640, height: 720 });
  const session = await emulateDesktopZoom(
    page,
    { width: 640, height: 720 },
    2,
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320);
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
  await expect(spanishHint).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await session.send("Emulation.clearDeviceMetricsOverride");
  await session.detach();
});

/**
 * The passport controls remain one usable flow.
 *
 * This lives here, and not in the unit suite, because jsdom performs no layout:
 * it reports every element as zero-sized, so the defect this guards against —
 * `flex: 1 1 16rem` landing on a column-axis child, or an absolute suggestion
 * list sitting on top of Save — is invisible to Vitest by construction. Only
 * a real engine can fail this test.
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

  const input = row.locator("input");
  const save = row.getByRole("button", { name: "Save" });

  // The breakpoint edges are intentional: 768px is still the narrow in-flow
  // layout; 769px returns to the shared desktop popup. The two smallest cases
  // retain the exact audited heights because the list cap depends on dvh.
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 375, height: 812 },
    { width: 767, height: 900 },
    { width: 768, height: 900 },
    { width: 769, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await row.evaluate((form) => form.scrollIntoView({ block: "start" }));
    await input.fill("");
    await input.fill("i");
    await expect(row.getByRole("listbox")).toBeVisible();
    const geometry = await row.evaluate((form) => {
      const input = form.querySelector("input") as HTMLElement;
      const save = form.querySelector(".voy-btn") as HTMLElement;
      const list = form.querySelector(".voy-combobox__list") as HTMLElement;
      const inputBox = input.getBoundingClientRect();
      const saveBox = save.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      const overlapWidth = Math.max(
        0,
        Math.min(saveBox.right, listBox.right) -
          Math.max(saveBox.left, listBox.left),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(saveBox.bottom, listBox.bottom) -
          Math.max(saveBox.top, listBox.top),
      );
      return {
        wrapperHeight: Math.round(
          (
            form.querySelector(".voy-field") as HTMLElement
          ).getBoundingClientRect().height,
        ),
        inputHeight: Math.round(inputBox.height),
        listPosition: getComputedStyle(list).position,
        listOffset: Math.round(listBox.top - inputBox.bottom),
        overlapArea: Math.round(overlapWidth * overlapHeight),
        listScrolls: list.scrollHeight > list.clientHeight,
        saveInViewport:
          saveBox.top >= 0 && saveBox.bottom <= window.innerHeight,
        rootContained:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      };
    });
    expect(geometry.wrapperHeight).toBeLessThan(geometry.inputHeight * 8);
    expect(geometry.overlapArea).toBe(0);
    expect(geometry.saveInViewport).toBe(true);
    expect(geometry.rootContained).toBe(true);
    if (viewport.width <= 768) {
      expect(geometry.listPosition).toBe("static");
      expect(geometry.listScrolls).toBe(true);
    } else {
      expect(geometry.listPosition).toBe("absolute");
      expect(geometry.listOffset).toBeLessThan(12);
    }

    // This is hit-tested by Playwright: an overlapping option intercepts the
    // click and fails, even if rectangle arithmetic were accidentally wrong.
    await save.click({ timeout: 2_000 });
    await expect(input).toBeFocused();
    await expect(row.getByRole("alert")).toHaveCount(1);
  }

  // A non-Visa combobox keeps the shared popup contract at a narrow width.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editTrip = page.getByRole("dialog", { name: "Edit trip" });
  await editTrip.getByLabel(/^To/).fill("a");
  const sharedList = editTrip.getByRole("listbox");
  await expect(sharedList).toBeVisible();
  expect(
    await sharedList.evaluate((list) => getComputedStyle(list).position),
  ).toBe("absolute");
  await editTrip.getByRole("button", { name: "Cancel" }).click();

  // Repeat the repaired Visa interaction with 200%-equivalent desktop zoom
  // reflow on a 640×720 physical surface (320×360 CSS pixels, DPR 2).
  await page.setViewportSize({ width: 640, height: 720 });
  await row.evaluate((form) => form.scrollIntoView({ block: "start" }));
  await input.fill("IN");
  await expect(row.getByRole("alert")).toHaveCount(0);
  const session = await emulateDesktopZoom(
    page,
    { width: 640, height: 720 },
    2,
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320);
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
  await row.evaluate((form) => form.scrollIntoView({ block: "start" }));
  await input.fill("");
  await input.fill("i");
  await expect(row.getByRole("listbox")).toBeVisible();
  const zoomed = await row.evaluate((form) => {
    const listBox = (
      form.querySelector(".voy-combobox__list") as HTMLElement
    ).getBoundingClientRect();
    const saveBox = (
      form.querySelector(".voy-btn") as HTMLElement
    ).getBoundingClientRect();
    return {
      intersects:
        Math.min(saveBox.right, listBox.right) >
          Math.max(saveBox.left, listBox.left) &&
        Math.min(saveBox.bottom, listBox.bottom) >
          Math.max(saveBox.top, listBox.top),
      listScrolls:
        (form.querySelector(".voy-combobox__list") as HTMLElement)
          .scrollHeight >
        (form.querySelector(".voy-combobox__list") as HTMLElement).clientHeight,
      rootContained:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    };
  });
  expect(zoomed.intersects).toBe(false);
  expect(zoomed.listScrolls).toBe(true);
  expect(zoomed.rootContained).toBe(true);
  await save.click({ timeout: 2_000 });
  await expect(input).toBeFocused();
  await expect(row.getByRole("alert")).toHaveCount(1);
  await session.send("Emulation.clearDeviceMetricsOverride");
  await session.detach();
});

test("nested workspace detours preserve route, query, and page focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a trip" }).first().click();
  const createTrip = page.getByRole("dialog", { name: "Create a trip" });
  await createTrip.getByLabel("From").fill("Chicago");
  await createTrip.getByLabel("To").fill("Lisbon");
  await createTrip.getByLabel("Start date").fill(isoDay(50));
  await createTrip.getByLabel("End date").fill(isoDay(57));
  await createTrip
    .getByLabel("Trip name (optional)")
    .fill("Nested detour trip");
  await createTrip.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: "Open Nested detour trip" }).click();
  await page.getByRole("link", { name: "Visa" }).click();
  await expect(page).toHaveURL(/#section-visa$/);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole("button", { name: "Search workspace" }).click();
  const searchHeading = page.getByRole("heading", {
    name: "Search workspace",
    level: 1,
  });
  await expect(searchHeading).toBeFocused();
  await page.getByLabel("Search all trips").fill("Nested detour");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsHeading = page.getByRole("heading", {
    name: "Settings",
    level: 1,
  });
  await expect(settingsHeading).toBeFocused();
  await expect(
    page.getByText(
      /browser-from-source build still stores your workspace in local SQLite/i,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(searchHeading).toBeFocused();
  await expect(page.getByLabel("Search all trips")).toHaveValue(
    "Nested detour",
  );

  await page.getByRole("button", { name: "Back" }).click();
  await expect(
    page.getByRole("heading", { name: "Nested detour trip", level: 1 }),
  ).toBeFocused();
  await expect(page).toHaveURL(/#section-visa$/);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.goForward();
  await expect(searchHeading).toBeFocused();
  await expect(page.getByLabel("Search all trips")).toHaveValue(
    "Nested detour",
  );
  await page.goForward();
  await expect(settingsHeading).toBeFocused();

  // A pasted/deep-linked detour has no app-owned predecessor. Its in-app Back
  // goes safely up to All Trips instead of escaping the workspace or doing
  // nothing, even though this browser tab has older cross-document history.
  await page.goto("/?view=search");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(
    page.getByRole("heading", { name: "Trips", level: 1 }),
  ).toBeFocused();

  // Search text belongs to one private history entry, not to every Search
  // visit in the tab. A fresh visit stays blank through its own Settings
  // detour even after an older visit held text.
  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search all trips").fill("First visit");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(
    page.getByRole("heading", { name: "Trips", level: 1 }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Search workspace" }).click();
  await expect(page.getByLabel("Search all trips")).toHaveValue("");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Search all trips")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Search workspace", level: 1 }),
  ).toBeFocused();
});
