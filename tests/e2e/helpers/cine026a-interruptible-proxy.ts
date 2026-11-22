import http from "node:http";
import net from "node:net";

/**
 * CINE-026-A: a CONNECT-only forward proxy that can sever, and later restore, the browser's TCP path to
 * ONE allow-listed host. It tunnels TLS end to end (no interception, no decryption), so the page keeps its
 * own certificate validation, cookies and Realtime authorization. `interrupt()` destroys every open tunnel
 * and refuses new ones, which is a genuine transport failure for the page's live WebSocket in every engine
 * (unlike BrowserContext.setOffline, which does not sever an open WebKit socket, and routeWebSocket, which
 * cannot intercept WebKit's Realtime socket).
 *
 * `options.connectHost` / `options.connectPort` exist only so the unit test can tunnel to a loopback echo
 * server; production use leaves them unset and connects to the allow-listed host itself.
 */
export type InterruptibleProxy = Awaited<ReturnType<typeof startInterruptibleProxy>>;

export async function startInterruptibleProxy(allowedHost: string, options: { connectHost?: string; connectPort?: number } = {}) {
  const tunnels = new Set<net.Socket>();
  const stats = { connects: 0, refused: 0, tunnelsCut: 0, deniedHosts: 0 };
  let blocked = false;
  let closed = false;
  const server = http.createServer((_request, response) => { response.writeHead(502); response.end("CONNECT-only proxy"); });
  server.on("connect", (request, client: net.Socket, head) => {
    const [host, portText] = String(request.url).split(":");
    if (closed || host !== allowedHost) { stats.deniedHosts += 1; client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    stats.connects += 1;
    if (blocked) { stats.refused += 1; client.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); return; }
    // Track BOTH sockets before the upstream handshake completes, so close()/interrupt() also reach tunnels
    // whose upstream connection is still being established.
    const upstream = net.connect(options.connectPort ?? Number(portText || 443), options.connectHost ?? host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    tunnels.add(client);
    tunnels.add(upstream);
    const drop = () => { client.destroy(); upstream.destroy(); tunnels.delete(client); tunnels.delete(upstream); };
    client.on("error", drop);
    upstream.on("error", drop);
    client.on("close", drop);
    upstream.on("close", drop);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const { port } = server.address() as net.AddressInfo;
  const destroyTunnels = () => {
    for (const socket of tunnels) { stats.tunnelsCut += 1; socket.destroy(); }
    tunnels.clear();
  };
  return {
    url: `http://127.0.0.1:${port}`,
    stats,
    openTunnels: () => tunnels.size,
    interrupt() {
      blocked = true;
      destroyTunnels();
    },
    restore() { blocked = false; },
    /** Idempotent and non-throwing: safe in a `finally` that must not replace the original error. */
    async close() {
      if (closed) return;
      closed = true;
      blocked = true;
      destroyTunnels();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Owns the proxy lifecycle for the whole scope, including the fixtures a test builds inside it: the proxy is
 * closed (listener closed, every tunnel destroyed) whether `run` resolves, throws during setup or throws later.
 * The error `run` threw is rethrown unchanged; a cleanup failure never replaces it.
 */
export async function withInterruptibleProxy<T>(allowedHost: string, run: (proxy: InterruptibleProxy) => Promise<T>, options: { connectHost?: string; connectPort?: number } = {}): Promise<T> {
  const proxy = await startInterruptibleProxy(allowedHost, options);
  try {
    return await run(proxy);
  } finally {
    await proxy.close().catch(() => undefined);
  }
}
