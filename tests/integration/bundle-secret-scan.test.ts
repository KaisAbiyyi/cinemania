import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Client Bundle Secret Leak Prevention (Hard Gate)", () => {
  it("verifies production build artifact exists and client bundles contain zero server secrets", () => {
    const staticDir = path.join(process.cwd(), ".next", "static");

    // Hard gate 1: Build directory must exist; fail explicitly if absent
    expect(fs.existsSync(staticDir)).toBe(true);

    function scanDir(dir: string): string[] {
      let files: string[] = [];
      for (const item of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          files = files.concat(scanDir(fullPath));
        } else if (item.endsWith(".js")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const clientJsFiles = scanDir(staticDir);

    // Hard gate 2: Nonempty JS bundle inventory
    expect(clientJsFiles.length).toBeGreaterThan(0);

    // Tokens and secret markers to scan for (literal, urlencoded, base64)
    const rawTokens = [
      process.env.TMDB_API_RAT,
      "TMDB_SECRET_SENTINEL_BUILD_MARKER_999",
      "mock-tmdb-offline-rat-token",
      "mock-tmdb-offline-ci-token",
    ].filter(Boolean) as string[];

    for (const filePath of clientJsFiles) {
      const content = fs.readFileSync(filePath, "utf-8");

      for (const secret of rawTokens) {
        // 1. Raw literal search (no quote assumptions)
        expect(content).not.toContain(secret);

        // 2. URL-encoded representation
        const encoded = encodeURIComponent(secret);
        if (encoded !== secret) {
          expect(content).not.toContain(encoded);
        }

        // 3. Base64 representation (for strings >= 8 characters)
        if (secret.length >= 8) {
          const b64 = Buffer.from(secret).toString("base64");
          expect(content).not.toContain(b64);
        }
      }
    }
  });
});
