import { CapabilityAuthError } from "./guestCapability";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeHost(rawHost: string | null): string | null {
  if (!rawHost) return null;
  const trimmed = rawHost.split(",")[0]?.trim().toLowerCase();
  return trimmed || null;
}

function getExpectedOrigin(request: Request): { protocol: string; host: string } | null {
  try {
    const parsed = new URL(request.url);
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    const protocol = forwardedProto ? `${forwardedProto}:` : parsed.protocol.toLowerCase();
    const host =
      normalizeHost(request.headers.get("x-forwarded-host")) ||
      normalizeHost(request.headers.get("host")) ||
      parsed.host.toLowerCase();

    return { protocol, host };
  } catch {
    return null;
  }
}

function originsMatch(candidateUrl: string, expected: { protocol: string; host: string }): boolean {
  if (!candidateUrl || candidateUrl.toLowerCase() === "null") {
    return false;
  }
  try {
    const parsed = new URL(candidateUrl);
    return (
      parsed.protocol.toLowerCase() === expected.protocol &&
      parsed.host.toLowerCase() === expected.host
    );
  } catch {
    return false;
  }
}

/**
 * Enforces same-origin CSRF protection for cookie-authenticated mutating endpoints:
 * - Rejects Sec-Fetch-Site: cross-site / none
 * - Validates Origin or fallback Referer against the expected request origin
 * - Requires at least one same-origin signal (Origin, Referer, or Sec-Fetch-Site=same-origin)
 */
export function assertSameOriginCsrf(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site" || secFetchSite === "none") {
    throw new CapabilityAuthError(
      403,
      "CSRF_FORBIDDEN",
      "Cross-site mutating requests are not permitted."
    );
  }

  const expected = getExpectedOrigin(request);
  if (!expected) {
    throw new CapabilityAuthError(403, "CSRF_FORBIDDEN", "Unable to verify request origin.");
  }

  const originHeader = request.headers.get("origin")?.trim();
  if (originHeader !== undefined) {
    if (!originsMatch(originHeader, expected)) {
      throw new CapabilityAuthError(
        403,
        "CSRF_FORBIDDEN",
        "Request Origin does not match server origin."
      );
    }
    return;
  }

  const refererHeader = request.headers.get("referer")?.trim();
  if (refererHeader !== undefined) {
    if (!originsMatch(refererHeader, expected)) {
      throw new CapabilityAuthError(
        403,
        "CSRF_FORBIDDEN",
        "Request Referer does not match server origin."
      );
    }
    return;
  }

  if (secFetchSite === "same-origin") {
    return;
  }

  throw new CapabilityAuthError(
    403,
    "CSRF_FORBIDDEN",
    "Missing Origin, Referer, or Sec-Fetch-Site header for mutating request."
  );
}
