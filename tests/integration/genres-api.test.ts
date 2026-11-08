import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/genres/route";
import tmdbApi from "@/services/tmdbApi";
import { mockGenres } from "../fixtures/tmdb-fixtures";

describe("GET /api/genres integration tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns movie genres with HTTP 200 when type=movie", async () => {
    vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
      data: { genres: mockGenres.movie },
    } as never);

    const request = new Request("http://localhost:3000/api/genres?type=movie");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(mockGenres.movie);
    expect(tmdbApi.get).toHaveBeenCalledWith("/genre/movie/list");
  });

  it("returns tv genres with HTTP 200 when type=tv", async () => {
    vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
      data: { genres: mockGenres.tv },
    } as never);

    const request = new Request("http://localhost:3000/api/genres?type=tv");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(mockGenres.tv);
    expect(tmdbApi.get).toHaveBeenCalledWith("/genre/tv/list");
  });

  it("returns HTTP 400 when type is missing", async () => {
    const request = new Request("http://localhost:3000/api/genres");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: "Invalid type parameter" });
  });

  it("returns HTTP 400 when type is invalid", async () => {
    const request = new Request("http://localhost:3000/api/genres?type=invalid_type");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: "Invalid type parameter" });
  });

  it("returns HTTP 500 when TMDB upstream fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(new Error("Network Error"));

    const request = new Request("http://localhost:3000/api/genres?type=movie");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({ error: "Failed to fetch genres" });
  });
});
