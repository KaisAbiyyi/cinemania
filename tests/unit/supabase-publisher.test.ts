import { afterEach, expect, it, vi } from "vitest";
import { createSupabasePublisher } from "@/lib/server/realtime/supabasePublisher";
import { PublicationAuthorizationError } from "@/lib/server/realtime/dispatch";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("sends a private version-only broadcast with the server key", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const publisher = createSupabasePublisher("https://exampleproject.supabase.co", "server-key", async (input, options) => {
    url = String(input); init = options; return new Response(null, { status: 202 });
  });
  await publisher({ roomId: "d75a3c4c-c516-4b88-9803-0261932e62ac", version: 3 });
  expect(url).toContain("/realtime/v1/api/broadcast/");
  expect(url).toContain("private=true");
  expect(init?.redirect).toBe("error");
  expect(JSON.parse(String(init?.body))).toEqual({ roomId: "d75a3c4c-c516-4b88-9803-0261932e62ac", version: 3 });
  expect(new Headers(init?.headers).get("apikey")).toBe("server-key");
});

it("throws on a rejected broadcast and rejects invalid origin configuration", async () => {
  expect(() => createSupabasePublisher("http://evil.invalid", "key")).toThrow();
  const publisher = createSupabasePublisher("https://exampleproject.supabase.co", "key", async () => new Response(null, { status: 403 }));
  await expect(publisher({ roomId: "room", version: 1 })).rejects.toThrow();
});

it.each([401, 403])("backs off provider authorization status %s and emits a bounded diagnostic", async status => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const send = vi.fn(async () => new Response("synthetic upstream detail", { status }));
  const publish = createSupabasePublisher("https://exampleproject.supabase.co", "synthetic-key", send);
  const hint = { roomId: "synthetic-room", version: 1 };
  await expect(publish(hint)).rejects.toBeInstanceOf(PublicationAuthorizationError);
  await expect(publish(hint)).rejects.toBeInstanceOf(PublicationAuthorizationError);
  expect(send).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls.flat().join(" ")).not.toMatch(/synthetic-(key|room)|upstream detail/);
  clock.mockReturnValue(70_000);
  await expect(publish(hint)).rejects.toBeInstanceOf(PublicationAuthorizationError);
  expect(send).toHaveBeenCalledTimes(2);
});

it("accepts explicitly enabled loopback HTTP only outside production", () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CINEMATCH_ALLOW_LOCAL_REALTIME", "true");
  expect(() => createSupabasePublisher("http://127.0.0.1:54321", "key")).not.toThrow();
  expect(() => createSupabasePublisher("http://localhost:54321", "key")).not.toThrow();
  for (const bad of ["http://127.0.0.2:54321", "http://127.1:54321", "http://localhost.evil:54321", "http://user@localhost:54321", "http://localhost:54321/path", "http://localhost:54321?x=1", "http://localhost:54321/#x", "https://project.supabase.co:444"]) {
    expect(() => createSupabasePublisher(bad, "key")).toThrow();
  }
  vi.stubEnv("CINEMATCH_ALLOW_LOCAL_REALTIME", "false");
  expect(() => createSupabasePublisher("http://127.0.0.1:54321", "key")).toThrow();
  vi.stubEnv("CINEMATCH_ALLOW_LOCAL_REALTIME", "true");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => createSupabasePublisher("http://127.0.0.1:54321", "key")).toThrow();
  expect(() => createSupabasePublisher("https://project.supabase.co", "key")).not.toThrow();
});
