import { CapabilityAuthError } from "./guestCapability";
import { roomRequestOrigin } from "./requestOrigin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originsMatch(candidateUrl: string, expected: URL, originHeader: boolean): boolean {
  if (!candidateUrl || candidateUrl.toLowerCase() === "null") {
    return false;
  }
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (originHeader && (parsed.pathname !== "/" || parsed.search || parsed.hash)) return false;
    return parsed.origin === expected.origin;
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

  const expected = roomRequestOrigin(request);
  if (!expected) {
    throw new CapabilityAuthError(403, "CSRF_FORBIDDEN", "Unable to verify request origin.");
  }

  const originHeader = request.headers.get("origin")?.trim();
  if (originHeader !== undefined) {
    if (!originsMatch(originHeader, expected, true)) {
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
    if (!originsMatch(refererHeader, expected, false)) {
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
