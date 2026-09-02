import type { Locator } from "@playwright/test";

import { expect, test, type Page } from "./fixtures";

const VIEWPORTS = [320, 375, 414, 768, 1440] as const;

async function expectTarget(locator: Locator, viewportWidth: number) {
  await expect(locator).toBeVisible();
  // Dialog controls briefly inherit the sheet's 0.99 entrance scale. Measure
  // the settled target instead of treating that reduced-motion-safe flourish
  // as its layout size.
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return Math.min(box?.width ?? 0, box?.height ?? 0);
    })
    .toBeGreaterThanOrEqual(44);
  const box = await locator.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function expectRecurringTargets(page: Page, viewportWidth: number) {
  await expectTarget(
    page.getByRole("button", { name: "Search workspace" }),
    viewportWidth,
  );
  await expectTarget(
    page.getByRole("button", { name: "Settings" }),
    viewportWidth,
  );
  for (const radio of await page
    .getByRole("radiogroup", { name: "Color theme" })
    .getByRole("radio")
    .all()) {
    await expectTarget(radio, viewportWidth);
  }

  const create = page.getByRole("button", { name: "Create a trip" }).first();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a trip" });
  const close = dialog.getByRole("button", { name: "Close dialog" });
  await expectTarget(close, viewportWidth);
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(create).toBeFocused();
  await expectNoHorizontalOverflow(page);
}

test("recurring compact controls keep 44px targets across responsive widths and 200% zoom", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trips" })).toBeVisible();

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    await expectRecurringTargets(page, width);
  }

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 640,
    screenHeight: 1440,
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320);
  await expectRecurringTargets(page, 320);
  await session.send("Emulation.clearDeviceMetricsOverride");
  await session.detach();
});

test("theme roving focus and visible keyboard focus remain intact", async ({
  page,
}) => {
  await page.goto("/");
  const group = page.getByRole("radiogroup", { name: "Color theme" });
  const current = group.getByRole("radio", { checked: true });
  const before = await current.getAttribute("aria-label");
  await current.focus();
  await page.keyboard.press("ArrowRight");

  const next = group.getByRole("radio", { checked: true });
  await expect(next).toBeFocused();
  expect(await next.getAttribute("aria-label")).not.toBe(before);

  const search = page.getByRole("button", { name: "Search workspace" });
  await search.focus();
  const focusStyle = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(focusStyle.width).not.toBe("0px");
});
