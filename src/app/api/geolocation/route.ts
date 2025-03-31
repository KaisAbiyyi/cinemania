import { NextResponse } from "next/server";
import axios from "axios";

/**
 * API Route untuk mendapatkan region berdasarkan IP menggunakan ipinfo.io.
 * Contoh request:
 * GET /api/geolocation
 *
 * Pastikan untuk mengatur environment variable IPINFO_TOKEN dengan token yang valid.
 */
export async function GET(request: Request) {
    // Ambil IP dari header (fallback ke "127.0.0.1")
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "127.0.0.1";

    // Ambil token dari environment (jangan lupa atur IPINFO_TOKEN di environment Anda)
    console.log("Ini adalah IP" + ip)
    const token = process.env.IPINFO_TOKEN || "YOUR_TOKEN";

    // Jika IP adalah localhost, langsung kembalikan region default
    if (ip === "127.0.0.1") {
        return NextResponse.json({ region: "US" });
    }

    try {
        // Panggil API geolokasi menggunakan axios
        const { data } = await axios.get(`https://ipinfo.io/${ip}`, {
            params: { token },
        });
        const region = data.country || "US";
        console.log("Ini adalah region" + region)
        return NextResponse.json({ region });
    } catch (error: any) {
        console.error("Error fetching geolocation:", error);
        return NextResponse.json({ region: "US" }, { status: 500 });
    }
}
