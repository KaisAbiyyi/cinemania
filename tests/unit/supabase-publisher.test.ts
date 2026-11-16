import { expect, it } from "vitest";
import { createSupabasePublisher } from "@/lib/server/realtime/supabasePublisher";

it("sends a private version-only broadcast with the server key", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const publisher = createSupabasePublisher("https://exampleproject.supabase.co", "server-key", async (input, options) => {
    url = String(input); init = options; return new Response(null, { status: 202 });
  });
  await publisher({ roomId: "d75a3c4c-c516-4b88-9803-0261932e62ac", version: 3 });
  expect(url).toContain("/realtime/v1/api/broadcast/");
  expect(url).toContain("private=true");
  expect(JSON.parse(String(init?.body))).toEqual({ roomId: "d75a3c4c-c516-4b88-9803-0261932e62ac", version: 3 });
  expect(new Headers(init?.headers).get("apikey")).toBe("server-key");
});

it("throws on a rejected broadcast and rejects invalid origin configuration", async () => {
  expect(() => createSupabasePublisher("http://evil.invalid", "key")).toThrow();
  const publisher = createSupabasePublisher("https://exampleproject.supabase.co", "key", async () => new Response(null, { status: 403 }));
  await expect(publisher({ roomId: "room", version: 1 })).rejects.toThrow();
});
