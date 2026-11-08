import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/languages/route";
import tmdbApi from "@/services/tmdbApi";
import { mockLanguages } from "../fixtures/tmdb-fixtures";

describe("GET /api/languages integration tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns language list with HTTP 200 using seeded fixtures", async () => {
    vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
      data: mockLanguages,
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual(mockLanguages);
    expect(tmdbApi.get).toHaveBeenCalledWith("/configuration/languages");
  });

  it("returns HTTP 500 when TMDB upstream fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(new Error("Connection reset"));

    const response = await GET();
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data).toEqual({ error: "Failed to fetch languages" });
  });
});
