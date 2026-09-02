const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function validateSourceApiOrigin(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "VOYALIER_SOURCE_API_ORIGIN must be an HTTP loopback origin",
    );
  }
  return url.origin;
}

export function sourceBrowserCsp(nonce: string, apiOrigin?: string): string {
  const connects = [
    "'self'",
    "ws://127.0.0.1:5173",
    "ws://localhost:5173",
    "https://tiles.openfreemap.org",
  ];
  if (apiOrigin) connects.push(apiOrigin);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    `connect-src ${connects.join(" ")}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join("; ");
}
