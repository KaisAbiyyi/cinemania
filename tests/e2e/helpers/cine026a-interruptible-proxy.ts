import http from "node:http";
import net from "node:net";

/**
 * CINE-026-A: a CONNECT-only forward proxy that can sever, and later restore, the browser's TCP path to
 * ONE allow-listed host. It tunnels TLS end to end (no interception, no decryption), so the page keeps its
 * own certificate validation, cookies and Realtime authorization. `interrupt()` destroys every open tunnel
 * and refuses new ones, which is a genuine transport failure for the page's live WebSocket in every engine
 * (unlike BrowserContext.setOffline, which does not sever an open WebKit socket, and routeWebSocket, which
 * cannot intercept WebKit's Realtime socket).
 */
export async function startInterruptibleProxy(allowedHost: string) {
  const tunnels = new Set<net.Socket>();
  const stats = { connects: 0, refused: 0, tunnelsCut: 0, deniedHosts: 0 };
  let blocked = false;
  const server = http.createServer((_request, response) => { response.writeHead(502); response.end("CONNECT-only proxy"); });
  server.on("connect", (request, client: net.Socket, head) => {
    const [host, portText] = String(request.url).split(":");
    if (host !== allowedHost) { stats.deniedHosts += 1; client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    stats.connects += 1;
    if (blocked) { stats.refused += 1; client.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); return; }
    const upstream = net.connect(Number(portText || 443), host, () => {
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stats,
    interrupt() {
      blocked = true;
      for (const socket of tunnels) { stats.tunnelsCut += 1; socket.destroy(); }
      tunnels.clear();
    },
    restore() { blocked = false; },
    async close() {
      blocked = true;
      for (const socket of tunnels) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
