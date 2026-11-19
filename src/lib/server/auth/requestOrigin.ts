export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function roomRequestOrigin(request: Request): URL | null {
  try {
    const configured = process.env.CINEMATCH_APP_ORIGIN?.trim();
    const url = new URL(configured || request.url);
    if (!configured && process.env.VERCEL === "1") {
      const host = request.headers.get("host");
      if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
      return new URL(`https://${host}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (configured && (url.pathname !== "/" || url.search || url.hash)) return null;
    // Self-hosted Next can construct request.url with its loopback bind name
    // while the browser uses a different loopback name and port.
    const host = request.headers.get("host");
    if (!configured && isLoopbackHostname(url.hostname) && host && /^[a-z0-9.:[\]-]+$/i.test(host)) {
      const direct = new URL(`${url.protocol}//${host}`);
      if (isLoopbackHostname(direct.hostname)) return direct;
    }
    return new URL(url.origin);
  } catch {
    return null;
  }
}
