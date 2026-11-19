import axios from "axios";
import { isIP } from "node:net";
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
    const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
    const ip = forwarded?.split(",")[0]?.trim() || "127.0.0.1";
    const token = process.env.IPINFO_TOKEN;

    if (!isIP(ip) || ip === "127.0.0.1" || ip === "::1" || ip.toLowerCase() === "::ffff:127.0.0.1") {
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
                    maxRedirects: 0,
                    timeout: 3000,
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
        console.error("[IPINFO_UPSTREAM_ERROR] Check region lookup connectivity and configuration.");
        return jsonWithCachePolicy({ region: "US" }, policy, "BYPASS", { status: 500 });
    }
}
