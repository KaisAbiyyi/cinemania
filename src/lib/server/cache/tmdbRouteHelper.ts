import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import type { EndpointCachePolicy } from "./cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "./serverCache";

const NUMERIC_ID_REGEX = /^\d+$/;

export async function handleCachedMediaSubresource(options: {
  request: Request;
  id: string;
  policy: EndpointCachePolicy;
  subpath?: string;
  forwardQueryParams?: boolean;
  errorMessage: string;
}): Promise<NextResponse> {
  const { request, id, policy, subpath = "", forwardQueryParams = true, errorMessage } = options;

  if (!NUMERIC_ID_REGEX.test(id)) {
    return NextResponse.json(
      { error: "Invalid media ID parameter." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const url = new URL(request.url);
  const mediaType = url.searchParams.get("mediaType");

  if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
    return NextResponse.json(
      { error: "Invalid or missing mediaType query parameter." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const endpoint = `/${mediaType}/${id}${subpath}`;
  const paramsObject: Record<string, string> = {};
  if (forwardQueryParams) {
    for (const [k, v] of url.searchParams.entries()) {
      if (k !== "mediaType") {
        paramsObject[k] = v;
      }
    }
  }

  try {
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      { mediaType, id, ...paramsObject },
      async () => {
        const res =
          Object.keys(paramsObject).length > 0
            ? await tmdbApi.get(endpoint, { params: paramsObject })
            : await tmdbApi.get(endpoint);
        return res.data;
      }
    );
    return jsonWithCachePolicy(data, policy, cacheStatus);
  } catch (error: unknown) {
    console.error(errorMessage, error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function handleCachedTmdbEntityResource(options: {
  id: string;
  policy: EndpointCachePolicy;
  endpoint: string;
  errorMessage: string;
}): Promise<NextResponse> {
  const { id, policy, endpoint, errorMessage } = options;

  if (!NUMERIC_ID_REGEX.test(id)) {
    return NextResponse.json(
      { error: "Invalid ID parameter." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      { id },
      async () => {
        const res = await tmdbApi.get(endpoint);
        return res.data;
      }
    );
    return jsonWithCachePolicy(data, policy, cacheStatus);
  } catch (error: unknown) {
    console.error(errorMessage, error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
