// @vitest-environment node
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startInterruptibleProxy, withInterruptibleProxy, type InterruptibleProxy } from "../e2e/helpers/cine026a-interruptible-proxy";

/** CINE-026-A: the transport-cut proxy must never leak a listener or a tunnel, even when setup fails. */
const HOST = "project.supabase.test";
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

async function echoServer(): Promise<number> {
  const server = net.createServer((socket) => { socket.on("error", () => undefined); socket.pipe(socket); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as net.AddressInfo).port;
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
    socket.on("error", () => undefined);
    socket.once("error", reject);
    sockets.push(socket);
  });
}

async function tunnel(proxy: InterruptibleProxy, host = HOST): Promise<{ socket: net.Socket; status: number }> {
  const socket = await connect(Number(new URL(proxy.url).port));
  const head = await new Promise<string>((resolve) => {
    socket.once("data", (data) => resolve(data.toString("latin1")));
    socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
  });
  return { socket, status: Number(head.split(" ")[1]) };
}

const closed = (socket: net.Socket) => new Promise<void>((resolve) => { if (socket.destroyed) resolve(); else socket.once("close", () => resolve()); });

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("interruptible proxy", () => {
  it("tunnels to the allow-listed host, refuses other hosts, and severs then restores on demand", async () => {
    const echoPort = await echoServer();
    const proxy = await startInterruptibleProxy(HOST, { connectHost: "127.0.0.1", connectPort: echoPort });
    try {
      const first = await tunnel(proxy);
      expect(first.status).toBe(200);
      const echoed = await new Promise<string>((resolve) => { first.socket.once("data", (data) => resolve(data.toString())); first.socket.write("ping"); });
      expect(echoed).toBe("ping");
      expect((await tunnel(proxy, "evil.example")).status).toBe(403);

      proxy.interrupt();
      await closed(first.socket);
      expect(proxy.stats.tunnelsCut).toBeGreaterThan(0);
      expect((await tunnel(proxy)).status).toBe(503);
      expect(proxy.stats.refused).toBe(1);

      proxy.restore();
      expect((await tunnel(proxy)).status).toBe(200);
    } finally {
      await proxy.close();
    }
  });

  it("close() destroys every open tunnel, stops listening, and is idempotent", async () => {
    const echoPort = await echoServer();
    const proxy = await startInterruptibleProxy(HOST, { connectHost: "127.0.0.1", connectPort: echoPort });
    const tunnels = await Promise.all([tunnel(proxy), tunnel(proxy), tunnel(proxy)]);
    expect(tunnels.map((entry) => entry.status)).toEqual([200, 200, 200]);
    expect(proxy.openTunnels()).toBeGreaterThanOrEqual(3);
    await proxy.close();
    await Promise.all(tunnels.map((entry) => closed(entry.socket)));
    expect(proxy.openTunnels()).toBe(0);
    await expect(proxy.close()).resolves.toBeUndefined();
    await expect(connect(Number(new URL(proxy.url).port))).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("withInterruptibleProxy closes the proxy and every tunnel when setup fails, preserving the original error", async () => {
    const echoPort = await echoServer();
    const setupFailure = new Error("room creation failed under staging capacity pressure");
    let captured: InterruptibleProxy | undefined;
    let leaked: net.Socket | undefined;
    await expect(withInterruptibleProxy(HOST, async (proxy) => {
      captured = proxy;
      leaked = (await tunnel(proxy)).socket; // an interrupted setup may already have opened a tunnel
      throw setupFailure; // stands in for makeRoom() rejecting before the test body's own try/finally
    }, { connectHost: "127.0.0.1", connectPort: echoPort })).rejects.toBe(setupFailure);
    expect(captured).toBeDefined();
    await closed(leaked!);
    expect(captured!.openTunnels()).toBe(0);
    await expect(connect(Number(new URL(captured!.url).port))).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("withInterruptibleProxy returns the scope result and still closes on success", async () => {
    let captured: InterruptibleProxy | undefined;
    const value = await withInterruptibleProxy(HOST, async (proxy) => { captured = proxy; return 42; });
    expect(value).toBe(42);
    await expect(connect(Number(new URL(captured!.url).port))).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
