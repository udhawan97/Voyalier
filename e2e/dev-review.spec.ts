import { expect, test, type Page } from "./fixtures";

test.use({ timezoneId: "America/Chicago" });

async function createTrip(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a trip" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a trip" });
  await dialog.getByLabel("From").fill("Chicago");
  await dialog.getByLabel("To").fill("Kyoto");
  await dialog.getByLabel("Start date").fill("2026-10-07");
  await dialog.getByLabel("End date").fill("2026-10-09");
  await dialog.getByLabel("Trip name (optional)").fill(title);
  await dialog.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("button", { name: `Open ${title}` }).click();
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
}

test("Today uses the device date when UTC is tomorrow and refreshes on resume", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date("2026-10-08T01:30:00Z"));
  const referenceDates: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/today"))
      referenceDates.push(url.searchParams.get("referenceDate") ?? "missing");
  });
  await createTrip(page, `Device date ${info.project.name} ${info.retry}`);
  const today = page.getByRole("region", { name: "Today" });
  await expect(today.getByText("Day 1 of 3")).toBeVisible();
  expect(referenceDates.at(-1)).toBe("2026-10-07");

  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByLabel("Name").fill("October 7 floating plan");
  await plans.getByLabel("Start (optional)").fill("2026-10-07T12:00");
  await plans.getByRole("button", { name: "Add to plan" }).click();
  await expect(today.getByText(/October 7 floating plan/)).toBeVisible();

  await page.clock.setFixedTime(new Date("2026-10-08T05:01:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(today.getByText("Day 2 of 3")).toBeVisible();
  await expect(today.getByText(/October 7 floating plan/)).toHaveCount(0);
  expect(referenceDates.at(-1)).toBe("2026-10-08");
  await expect(
    plans.getByText("October 7 floating plan", { exact: true }),
  ).toBeVisible();
});

test("Today separates confirmed facts from plans and returns to both by keyboard", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date("2026-10-08T01:30:00Z"));
  await createTrip(page, `Source labels ${info.project.name} ${info.retry}`);
  await page.getByRole("button", { name: "Add reservation" }).first().click();
  const reservation = page.getByRole("dialog", { name: "Add a reservation" });
  await reservation
    .getByLabel("Airline", { exact: true })
    .fill("Fictional Pacific");
  await reservation.getByLabel("Flight number").fill("FP18");
  await reservation.getByLabel("Departs (local)").fill("2026-10-07T08:00");
  await reservation.getByLabel("Arrives (local)").fill("2026-10-07T10:00");
  await reservation.getByRole("button", { name: "Add to Blueprint" }).click();
  await expect(reservation).toBeHidden();
  const plans = page.getByRole("region", { name: "Activities & transfers" });
  await plans.getByLabel("Name").fill("Dinner intention");
  await plans.getByLabel("Start (optional)").fill("2026-10-07T18:00");
  await plans.getByRole("button", { name: "Add to plan" }).click();
  const today = page.getByRole("region", { name: "Today" });
  const departure = today
    .getByRole("listitem")
    .filter({ hasText: /Depart —.*FP18/ });
  const intention = today
    .getByRole("listitem")
    .filter({ hasText: "Dinner intention" });
  await expect(
    departure.getByText("Confirmed evidence", { exact: true }),
  ).toBeVisible();
  await expect(intention.getByText("Your plan", { exact: true })).toBeVisible();

  await departure.getByRole("button", { name: /Show in Plan/ }).focus();
  await page.keyboard.press("Enter");
  const fact = page
    .locator('[data-search-source="confirmed_fact"]')
    .filter({ hasText: "FP18" });
  await expect(fact).toBeFocused();
  expect(page.url()).not.toContain(
    (await fact.getAttribute("data-search-record"))!,
  );
  await intention.getByRole("button", { name: /Show in Plan/ }).focus();
  await page.keyboard.press("Enter");
  const plan = page
    .locator('[data-search-source="trip_item"]')
    .filter({ hasText: "Dinner intention" });
  await expect(plan).toBeFocused();
  expect(page.url()).not.toContain(
    (await plan.getAttribute("data-search-record"))!,
  );
});

test("Wallet source read failure stays unknown and retry returns to the real source", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date("2026-10-08T01:30:00Z"));
  await createTrip(page, `Source retry ${info.project.name} ${info.retry}`);
  await page
    .getByRole("button", { name: "Import confirmation" })
    .first()
    .click();
  const importer = page.getByRole("dialog", { name: "Import a document" });
  const sourceLabel = `Synthetic local source ${info.project.name} ${info.retry}`;
  await importer.getByLabel("Label (optional)").fill(sourceLabel);
  await importer
    .getByLabel("Content", { exact: true })
    .fill(
      "Synthetic local travel reading. No extracted reservation or provider contact.",
    );
  await importer.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Imported" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  const wallet = page.getByRole("region", { name: "Document wallet" });
  await wallet.getByLabel("Wallet label").fill("Source-linked artifact");
  await wallet
    .getByLabel("Imported source")
    .selectOption({ label: `Link: ${sourceLabel}` });
  await wallet.getByRole("button", { name: "Add to wallet" }).click();
  await expect(
    wallet.getByText(`confirmation · ${sourceLabel}`, { exact: true }),
  ).toBeVisible();

  let failRead = true;
  await page.route("**/api/v1/trips/*/documents", async (route) => {
    if (failRead && route.request().method() === "GET") {
      await route.fulfill({
        status: 503,
        json: {
          code: "transport/failure",
          message: "Synthetic source-list read failure",
        },
      });
      return;
    }
    await route.continue();
  });
  await page.reload();
  await expect(wallet.getByText(/Source unavailable/)).toBeVisible();
  await expect(wallet.getByText(/Source removed/)).toHaveCount(0);
  failRead = false;
  await wallet.getByRole("button", { name: "Retry sources" }).click();
  await expect(
    wallet.getByText(`confirmation · ${sourceLabel}`, { exact: true }),
  ).toBeVisible();
  await expect(wallet.getByText(/Source unavailable/)).toHaveCount(0);
});

async function pauseWrite(page: Page, pattern: string, method: string) {
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  let paused = false;
  await page.route(pattern, async (route) => {
    if (!paused && route.request().method() === method) {
      paused = true;
      received();
      await gate;
    }
    await route.continue();
  });
  return { release, started };
}

test("a dismissed creation cannot close a replacement draft or steal its focus", async ({
  page,
}, info) => {
  const title = `Delayed create ${info.project.name} ${info.retry}`;
  await page.goto("/");
  const pause = await pauseWrite(page, "**/api/v1/trips/*/concierge", "PUT");
  try {
    await page.getByRole("button", { name: "Create a trip" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create a trip" });
    await dialog.getByLabel("From").fill("Chicago");
    await dialog.getByLabel("To").fill("Rome");
    await dialog.getByLabel("Start date").fill("2027-06-01");
    await dialog.getByLabel("End date").fill("2027-06-05");
    await dialog.getByLabel("Trip name (optional)").fill(title);
    await dialog.getByRole("button", { name: "Create trip" }).click();
    await pause.started;
    await dialog.press("Escape");
    await page.getByRole("button", { name: "Create a trip" }).first().click();
    await dialog.getByLabel("To").fill("Replacement draft");
    pause.release();
    await expect(
      page.getByRole("button", { name: `Open ${title}` }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("To")).toHaveValue("Replacement draft");
    await expect(dialog.getByLabel("To")).toBeFocused();
  } finally {
    pause.release();
  }
});

test("a dismissed edit refreshes the trip while preserving the replacement editor", async ({
  page,
}, info) => {
  const title = `Delayed edit ${info.project.name} ${info.retry}`;
  await createTrip(page, title);
  const pause = await pauseWrite(page, "**/api/v1/trips/*", "PATCH");
  try {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit trip" });
    await dialog.getByLabel("Trip name (optional)").fill(`${title} saved`);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await pause.started;
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog.getByLabel("To").fill("Replacement destination");
    pause.release();
    await expect(
      page.getByRole("heading", { name: `${title} saved`, level: 1 }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("To")).toHaveValue(
      "Replacement destination",
    );
    await expect(dialog.getByLabel("To")).toBeFocused();
  } finally {
    pause.release();
  }
});

for (const locale of ["en", "es"]) {
  test(`retained setup choices can be reviewed by keyboard in ${locale} at narrow width (Chromium: 2x pixel density)`, async ({
    page,
  }, info) => {
    await createTrip(
      page,
      `Setup review ${locale} ${info.project.name} ${info.retry}`,
    );
    await page.evaluate((language) => {
      localStorage.setItem("voyalier.locale", language);
      localStorage.setItem("voyalier-theme", "dark");
    }, locale);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const cockpit = page.getByRole("region", {
      name: "Everything between here and there",
    });
    const bedrooms = cockpit.getByRole("spinbutton", { name: "Bedrooms" });
    const save = cockpit.getByRole("button", { name: "Save setup" });
    const pause = await pauseWrite(page, "**/api/v1/trips/*/concierge", "PUT");
    let saves = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname.endsWith("/concierge")
      )
        saves += 1;
    });
    try {
      await bedrooms.fill("2");
      await save.click();
      await pause.started;
      await bedrooms.fill("3");
      pause.release();
      const review = cockpit.getByRole("button", {
        name: "Review setup changes",
      });
      await expect(review).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await review.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Review setup changes" });
      await expect(dialog).toHaveAttribute("lang", "en");
      await expect(dialog.getByText("Saved:", { exact: true })).toBeVisible();
      await expect(
        dialog.getByText("Your choice:", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath("setup-review-desktop.png"),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 320, height: 720 });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("setup-review-320.png"),
        animations: "disabled",
      });
      if (info.project.name === "chromium") {
        await page.setViewportSize({ width: 640, height: 720 });
        const zoom = await page.context().newCDPSession(page);
        try {
          await zoom.send("Emulation.setDeviceMetricsOverride", {
            width: 320,
            height: 360,
            deviceScaleFactor: 2,
            mobile: false,
            screenWidth: 640,
            screenHeight: 720,
          });
          await expect
            .poll(() => page.evaluate(() => window.innerWidth))
            .toBe(320);
          await expect
            .poll(() => page.evaluate(() => devicePixelRatio))
            .toBe(2);
          expect(
            await dialog.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBe(true);
        } finally {
          await zoom.send("Emulation.clearDeviceMetricsOverride");
          await zoom.detach();
        }
      }
      const keep = dialog.getByRole("button", {
        name: "Keep my setup choices",
      });
      await keep.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(save).toBeFocused();
      expect(saves).toBe(1);
      await expect(bedrooms).toHaveValue("3");
      await save.click();
      await expect(save).toBeEnabled();
      expect(saves).toBe(2);
      await page.reload();
      await expect(bedrooms).toHaveValue("3");
    } finally {
      pause.release();
    }
  });
}
