export interface SourceBootstrap {
  baseUrl: string;
  bearer: string;
}

declare global {
  interface Window {
    __VOYALIER_HTTP_BOOTSTRAP__?: SourceBootstrap;
  }
}

/**
 * Consume the launch credential exactly once. The launcher installs this value
 * only for the managed Vite origin and makes the property non-enumerable.
 */
export function consumeSourceBootstrap(): SourceBootstrap | undefined {
  if (typeof window === "undefined") return undefined;
  const bootstrap = window.__VOYALIER_HTTP_BOOTSTRAP__;
  delete window.__VOYALIER_HTTP_BOOTSTRAP__;
  if (!bootstrap) return undefined;

  const url = new URL(bootstrap.baseUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "The Voyalier source API must use an HTTP loopback origin.",
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(bootstrap.bearer)) {
    throw new Error("The Voyalier source launch credential is invalid.");
  }
  return { baseUrl: url.origin, bearer: bootstrap.bearer };
}
