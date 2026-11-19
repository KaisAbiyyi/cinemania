import axios from "axios";
import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/geolocation/route";

describe("GET /api/geolocation integration tests", () => {
  it("returns default US region for loopback IP", async () => {
    const request = new Request("http://localhost:3000/api/geolocation", {
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({ region: "US" });
  });

  it("returns default US region when no IP header is provided", async () => {
    const request = new Request("http://localhost:3000/api/geolocation");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ region: "US" });
  });

  it("reports a provider failure without logging request metadata", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = vi.spyOn(axios, "get").mockRejectedValue(new Error("synthetic provider request metadata"));
    try {
      const request = new Request("http://localhost:3000/api/geolocation", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      });
      expect((await GET(request)).status).toBe(500);
      expect(diagnostic).toHaveBeenCalledOnce();
      expect(diagnostic.mock.calls[0]).toEqual(["[IPINFO_UPSTREAM_ERROR] Check region lookup connectivity and configuration."]);
    } finally {
      upstream.mockRestore();
      diagnostic.mockRestore();
    }
  });
});
