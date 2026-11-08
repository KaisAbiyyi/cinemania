import { describe, it, expect } from "vitest";
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
});
