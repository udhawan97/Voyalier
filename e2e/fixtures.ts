import { expect, test as base, type Page } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:8787";
const API_TOKEN =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ expectedOrigin, baseUrl, bearer }) => {
        if (location.origin !== expectedOrigin) return;
        Object.defineProperty(window, "__VOYALIER_HTTP_BOOTSTRAP__", {
          configurable: true,
          enumerable: false,
          value: { baseUrl, bearer },
        });
      },
      {
        expectedOrigin: "http://127.0.0.1:5173",
        baseUrl: API_ORIGIN,
        bearer: API_TOKEN,
      },
    );
    await use(page);
  },
});

export { expect, test, type Page };
