import { expect, it } from "vitest";
import nextConfig, { pageReferrerPolicy, securityHeaders } from "../../next.config";

it("applies baseline anti-framing and anti-sniffing headers to every route", async () => {
  const rules = await nextConfig.headers!();
  expect(rules).toEqual([
    { source: "/:path*", headers: securityHeaders },
    { source: "/((?!api/).*)", headers: [pageReferrerPolicy] },
  ]);
  const byKey = Object.fromEntries(securityHeaders.map(h => [h.key.toLowerCase(), h.value]));
  expect(byKey["x-content-type-options"]).toBe("nosniff");
  expect(byKey["x-frame-options"]).toBe("DENY");
  // Only frame-ancestors: a script/style CSP needs a nonce-based design and its own tests.
  expect(byKey["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(byKey["permissions-policy"]).toContain("geolocation=()");
});

it("keeps the stricter API no-referrer policy by scoping the page referrer policy away from /api", async () => {
  const rules = await nextConfig.headers!();
  expect(pageReferrerPolicy.value).toBe("strict-origin-when-cross-origin");
  expect(securityHeaders.some(h => h.key.toLowerCase() === "referrer-policy")).toBe(false);
  const pages = new RegExp("^" + rules[1].source + "$");
  expect(pages.test("/api/rooms")).toBe(false);
  expect(pages.test("/api/rooms/x/votes")).toBe(false);
  expect(pages.test("/lobby/ABC123")).toBe(true);
  expect(pages.test("/")).toBe(true);
});
