import { expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

it("applies baseline anti-framing and anti-sniffing headers to every route", async () => {
  const rules = await nextConfig.headers!();
  expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  const byKey = Object.fromEntries(securityHeaders.map(h => [h.key.toLowerCase(), h.value]));
  expect(byKey["x-content-type-options"]).toBe("nosniff");
  expect(byKey["x-frame-options"]).toBe("DENY");
  // Only frame-ancestors: a script/style CSP needs a nonce-based design and its own tests.
  expect(byKey["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(byKey["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(byKey["permissions-policy"]).toContain("geolocation=()");
});
