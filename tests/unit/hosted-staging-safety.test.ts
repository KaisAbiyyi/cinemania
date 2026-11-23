import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const { validateHostedStaging, PROJECT } = createRequire(import.meta.url)("../hosted-supabase/environment.cjs");
const { createCapabilitySecret, assertQuiescent, assertClean } = createRequire(import.meta.url)("../../scripts/cine026/run-hosted-staging.cjs");
const consent = { CINE018_STAGING_PROJECT: PROJECT };
const valid = `SUPABASE_URL=https://${PROJECT}.supabase.co
SUPABASE_PUBLISHABLE_KEY=synthetic-publishable
SUPABASE_SECRET_KEY=synthetic-server
SUPABASE_JWT_SECRET=synthetic-jwt
SUPABASE_PG_HOST=db.${PROJECT}.supabase.co
SUPABASE_PG_PORT=5432
SUPABASE_PG_DATABASE=postgres
SUPABASE_PG_USER=postgres
SUPABASE_PG_PASSWORD=synthetic-password`;
describe("hosted staging safety boundary", () => {
  const emptyState = {
    rooms: 0, participants: 0, votes: 0, events: 0, advisory_locks: 0, advisory_waiters: 0,
    idle_transactions: 0, other_role_nonidle_sessions: 0, other_role_sessions: 0,
  };
  it("allows an idle pooler drain observation and still requires final session count zero", () => {
    const retained = { ...emptyState, other_role_sessions: 6 };
    expect(() => assertQuiescent(retained)).not.toThrow();
    expect(() => assertClean(retained)).toThrow(/other_role_sessions/);
    expect(() => assertClean(emptyState)).not.toThrow();
  });
  it.each(["rooms", "participants", "votes", "events", "advisory_locks", "advisory_waiters",
    "idle_transactions", "other_role_nonidle_sessions"])("refuses any remaining %s before the drain window", field => {
    expect(() => assertQuiescent({ ...emptyState, [field]: 1 })).toThrow(field);
  });
  it("creates an independent cryptographically random 32-byte capability secret per run", () => {
    const first = createCapabilitySecret();
    const second = createCapabilitySecret();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(first, "hex")).toHaveLength(32);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
  it("rejects consent supplied by a credential file", () => {
    expect(() => validateHostedStaging(`${valid}\nCINE018_STAGING_PROJECT=${PROJECT}\nALLOW_DESTRUCTIVE_PG_TESTS=true`, {})).toThrow(/consent/);
  });
  it("never imports destructive consent or arbitrary runtime options", () => {
    const result = validateHostedStaging(`${valid}\nALLOW_DESTRUCTIVE_PG_TESTS=true\nNODE_OPTIONS=unsafe`, consent);
    expect(result).not.toHaveProperty("ALLOW_DESTRUCTIVE_PG_TESTS");
    expect(result).not.toHaveProperty("NODE_OPTIONS");
  });
  it.each([`https://other.supabase.co`, `https://${PROJECT}.supabase.co/`, `https://user@${PROJECT}.supabase.co`, `https://${PROJECT}.supabase.co?x=1`])("rejects noncanonical API origin %s", url => {
    expect(() => validateHostedStaging(valid.replace(`https://${PROJECT}.supabase.co`, url), consent)).toThrow(/origin/);
  });
  it("rejects another project, transaction pooling and unbound pooler users", () => {
    expect(() => validateHostedStaging(valid, { CINE018_STAGING_PROJECT: "other" })).toThrow(/consent/);
    expect(() => validateHostedStaging(valid.replace("PORT=5432", "PORT=6543"), consent)).toThrow(/port/);
    expect(() => validateHostedStaging(valid.replace(`db.${PROJECT}.supabase.co`, "aws-0-ap-northeast-2.pooler.supabase.com"), consent)).toThrow(/endpoint/);
  });
  it("accepts only designated direct or correctly bound session connection", () => {
    expect(validateHostedStaging(valid, consent).SUPABASE_PG_USER).toBe("postgres");
    expect(validateHostedStaging(valid.replace(`db.${PROJECT}.supabase.co`, "aws-0-ap-northeast-2.pooler.supabase.com").replace("USER=postgres", `USER=postgres.${PROJECT}`), consent).SUPABASE_PG_USER).toBe(`postgres.${PROJECT}`);
  });
});
