import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Scans a Next.js static build directory for prohibited secret tokens.
 * Throws if the directory is missing or contains no JS bundles.
 */
export function scanClientBundlesForSecrets(
  staticDir: string,
  prohibitedSecrets: string[]
): { scannedFilesCount: number } {
  if (!fs.existsSync(staticDir)) {
    throw new Error(
      `Build artifact directory does not exist: ${staticDir}. Run 'npm run build' before scanning client bundles.`
    );
  }

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

  if (clientJsFiles.length === 0) {
    throw new Error(
      `Hard gate violation: No client JavaScript bundles found in ${staticDir}. Build output may be incomplete.`
    );
  }

  const activeSecrets = prohibitedSecrets.filter(Boolean);

  for (const filePath of clientJsFiles) {
    const content = fs.readFileSync(filePath, "utf-8");

    for (const secret of activeSecrets) {
      // 1. Literal search
      if (content.includes(secret)) {
        throw new Error(
          `Secret leak detected in ${path.relative(process.cwd(), filePath)}: literal secret found`
        );
      }

      // 2. URL-encoded representation
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret && content.includes(encoded)) {
        throw new Error(
          `Secret leak detected in ${path.relative(process.cwd(), filePath)}: URL-encoded secret found`
        );
      }

      // 3. Base64 representation (for strings >= 8 characters)
      if (secret.length >= 8) {
        const b64 = Buffer.from(secret).toString("base64");
        if (content.includes(b64)) {
          throw new Error(
            `Secret leak detected in ${path.relative(process.cwd(), filePath)}: Base64-encoded secret found`
          );
        }
      }
    }
  }

  return { scannedFilesCount: clientJsFiles.length };
}

describe("Client Bundle Secret Leak Prevention (Build-Tied Hard Gate)", () => {
  it("fails explicitly when build output directory is missing or empty (prevents silent skips)", () => {
    const missingDir = path.join(process.cwd(), ".next", "non-existent-static-dir-test");
    expect(() =>
      scanClientBundlesForSecrets(missingDir, ["dummy-secret"])
    ).toThrow(/Build artifact directory does not exist/);
  });

  it("verifies production build artifact exists and client bundles contain zero server secrets", () => {
    const staticDir = path.join(process.cwd(), ".next", "static");

    // In this build-tied suite, staticDir MUST exist from the preceding `npm run build`
    expect(fs.existsSync(staticDir)).toBe(true);

    const prohibitedTokens = [
      process.env.TMDB_API_RAT,
      process.env.CINEMATCH_CAPABILITY_SECRET,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_JWT_SECRET,
      process.env.DATABASE_URL,
      "TMDB_SECRET_SENTINEL_BUILD_MARKER_999",
      "mock-tmdb-offline-rat-token",
      "mock-tmdb-offline-ci-token",
    ].filter(Boolean) as string[];

    const result = scanClientBundlesForSecrets(staticDir, prohibitedTokens);
    expect(result.scannedFilesCount).toBeGreaterThan(0);
  });
});
