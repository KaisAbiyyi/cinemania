/** A credentials file supplies credentials, never consent or arbitrary runtime options. */
export function applyPgTestCredentials(source: string, target: Record<string, string | undefined>): void {
  const allowed = new Set(["SUPABASE_PG_HOST", "SUPABASE_PG_PORT", "SUPABASE_PG_DATABASE", "SUPABASE_PG_USER", "SUPABASE_PG_PASSWORD"]);
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (allowed.has(key) && !target[key]) target[key] = trimmed.slice(idx + 1).trim();
  }
}
