import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { handleCachedMediaSubresource } from "@/lib/server/cache/tmdbRouteHelper";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleCachedMediaSubresource({
    request,
    id,
    policy: ENDPOINT_CACHE_POLICIES.media_release_dates,
    subpath: "/release_dates",
    forwardQueryParams: false,
    errorMessage: "Failed to fetch release dates.",
  });
}
