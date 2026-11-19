import { expect, it } from "vitest";
import { applyPgTestCredentials } from "../live/pg-test-env";

it("a credential file cannot grant destructive consent or inject unrelated runtime configuration", () => {
  const env: Record<string, string | undefined> = {};
  applyPgTestCredentials("ALLOW_DESTRUCTIVE_PG_TESTS=true\nSUPABASE_PG_HOST=synthetic.invalid\nNODE_OPTIONS=--require hostile.cjs\nDATABASE_URL=postgres://unapproved", env);
  expect(env).toEqual({ SUPABASE_PG_HOST: "synthetic.invalid" });
});

it("preserves explicit invocation refusal and existing credentials", () => {
  const env: Record<string, string | undefined> = { ALLOW_DESTRUCTIVE_PG_TESTS: "false", SUPABASE_PG_HOST: "local.invalid" };
  applyPgTestCredentials("ALLOW_DESTRUCTIVE_PG_TESTS=true\nSUPABASE_PG_HOST=shared.invalid\nSUPABASE_PG_PASSWORD=synthetic-only", env);
  expect(env).toEqual({ ALLOW_DESTRUCTIVE_PG_TESTS: "false", SUPABASE_PG_HOST: "local.invalid", SUPABASE_PG_PASSWORD: "synthetic-only" });
});

it("preserves a deliberately supplied process opt-in without creating one from file content", () => {
  const env: Record<string, string | undefined> = { ALLOW_DESTRUCTIVE_PG_TESTS: "true" };
  applyPgTestCredentials("ALLOW_DESTRUCTIVE_PG_TESTS=false\nSUPABASE_PG_USER=synthetic-runner", env);
  expect(env).toEqual({ ALLOW_DESTRUCTIVE_PG_TESTS: "true", SUPABASE_PG_USER: "synthetic-runner" });
});
