import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { handleCachedTmdbEntityResource } from "@/lib/server/cache/tmdbRouteHelper";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleCachedTmdbEntityResource({
    id,
    policy: ENDPOINT_CACHE_POLICIES.person_detail,
    endpoint: `/person/${id}`,
    errorMessage: "Failed to fetch person details",
  });
}
