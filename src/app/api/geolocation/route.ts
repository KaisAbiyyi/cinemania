import axios from "axios";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import {
    cacheConcurrencyLimitResponse,
    cachedServerFetch,
    jsonWithCachePolicy,
} from "@/lib/server/cache/serverCache";

/**
 * API Route untuk mendapatkan region berdasarkan IP menggunakan ipinfo.io.
 * Classified PRIVATE: strictly bypassed from shared caching (private, no-store).
 */
export async function GET(request: Request) {
    const policy = ENDPOINT_CACHE_POLICIES.geolocation;
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "127.0.0.1";
    const token = process.env.IPINFO_TOKEN || "YOUR_TOKEN";

    if (ip === "127.0.0.1" || ip === "::1") {
        return jsonWithCachePolicy({ region: "US" }, policy, "BYPASS");
    }
    if (!token) {
        return jsonWithCachePolicy({ region: "US" }, policy, "BYPASS", { status: 500 });
    }
    try {
        const { data, cacheStatus } = await cachedServerFetch(
            policy,
            {},
            async () => {
                const res = await axios.get(`https://ipinfo.io/${ip}`, {
                    params: { token },
                });
                return { region: res.data.country || "US" };
            }
        );
        return jsonWithCachePolicy(data, policy, cacheStatus);
    } catch (error) {
        const overloadResponse = cacheConcurrencyLimitResponse(error);
        if (overloadResponse) {
            return overloadResponse;
        }
        console.error("Error fetching geolocation:", error);
        return jsonWithCachePolicy({ region: "US" }, policy, "BYPASS", { status: 500 });
    }
}
