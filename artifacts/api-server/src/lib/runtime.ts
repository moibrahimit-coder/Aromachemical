/**
 * Runtime boundaries are deliberately explicit. Vercel must use externally
 * configured providers and must never fall back to Replit-managed services.
 */
export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1";
}

export function requireExternalRuntimeConfig(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const values = names.map((name) => env[name]?.trim() ?? "");
  const missing = names.filter((_, index) => !values[index]);
  if (missing.length > 0) {
    throw new Error(
      `Vercel runtime requires configuration for: ${missing.join(", ")}.`,
    );
  }
  return values;
}

/**
 * Returns only a normalized origin from APP_URL. The request Host and
 * forwarded-host headers are intentionally never considered authoritative.
 */
export function canonicalAppOrigin(appUrl = process.env.APP_URL): string {
  if (!appUrl?.trim()) {
    throw new Error("Vercel runtime requires APP_URL to be configured.");
  }

  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error("APP_URL must be an absolute http(s) URL.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error(
      "APP_URL must be an origin-only http(s) URL without credentials, query, hash, or path.",
    );
  }
  return url.origin;
}

export function getCanonicalAppOrigin(): string {
  return canonicalAppOrigin();
}