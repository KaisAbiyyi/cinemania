/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Read-only hosted catalog vs canonical migrations in an exclusively owned LOCAL DB.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { loadHostedStaging } = require("./environment.cjs");
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { loadMigrationsFromCommit } = require("../../scripts/local-supabase/apply-migrations.cjs");
const { withDisposableDatabase } = require("../local-supabase/disposable-migration-db.cjs");

const catalog = `SELECT json_build_object(
 'columns',(SELECT json_agg(x) FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,character_maximum_length,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position) x),
 'constraints',(SELECT json_agg(x) FROM (SELECT c.relname,t.conname,pg_get_constraintdef(t.oid) def FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.conname) x),
 'indexes',(SELECT json_agg(x) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname) x),
 'functions',(SELECT json_agg(x) FROM (SELECT p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) def,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname) x),
 'policies',(SELECT json_agg(x) FROM (SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' OR (schemaname='realtime' AND policyname LIKE 'cinematch_%') ORDER BY schemaname,tablename,policyname) x),
 'tables',(SELECT json_agg(x) FROM (SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname) x),
 'triggers',(SELECT json_agg(x) FROM (SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname) x),
 'effective_grants',(SELECT json_agg(x) FROM (SELECT c.relname,r.rolname,p.privilege,has_table_privilege(r.rolname,c.oid,p.privilege) allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r CROSS JOIN (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege) p WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname,r.rolname,p.privilege) x),
 'sequence_grants',(SELECT json_agg(x) FROM (SELECT r.rolname,p.privilege,has_sequence_privilege(r.rolname,'public.room_events_id_seq',p.privilege) allowed FROM (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r CROSS JOIN (SELECT unnest(ARRAY['USAGE','SELECT','UPDATE']) privilege) p ORDER BY r.rolname,p.privilege) x)
 ) AS catalog;`;
const normalize = value => JSON.parse(JSON.stringify(value).replace(/\\r\\n/g, "\\n"));

async function main() {
  const target = loadHostedStaging();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Local safety checks deliberately run with NO hosted credentials in process env.
  const local = assertLocalStack().find(c => c.name === "cinematch-gh52d-db-1");
  const migrations = loadMigrationsFromCommit(head);
  const canonical = await withDisposableDatabase(local.id, async sql => {
    sql(`CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
      CREATE SCHEMA realtime; CREATE TABLE realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;`);
    sql("BEGIN;\n" + migrations.map(m => m.sql).join("\n") + "\nCOMMIT;");
    // Deparse expressions under the same search_path on both servers, so
    // auth.jwt() cannot render as jwt() on just one side.
    const output = sql("BEGIN; SET LOCAL search_path=pg_catalog; " + catalog + " COMMIT;");
    return normalize(JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)));
  });
  const db = new Client(target.pgConfig);
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    await db.query("SET LOCAL search_path=pg_catalog");
    const actual = normalize((await db.query(catalog)).rows[0].catalog);
    for (const key of Object.keys(canonical)) assert.deepEqual(actual[key], canonical[key], `Hosted canonical drift: ${key}`);
    const history = (await db.query("SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version")).rows;
    const digest = crypto.createHash("sha256").update(JSON.stringify(actual)).digest("hex");
    if (process.env.CINE018_EVIDENCE_DIR) fs.writeFileSync(require("node:path").join(process.env.CINE018_EVIDENCE_DIR, "hosted-catalog-sanitized.json"), JSON.stringify({ head, project: target.project, catalogSha256: digest, history, canonicalMigrations: migrations.map(m => ({ file: m.file, sha256: m.hash })), catalog: actual }, null, 2));
    console.log(JSON.stringify({ ok: true, head, project: target.project, catalogSha256: digest, checks: Object.keys(canonical), localDisposableDatabaseRemoved: true, history }));
  } finally { await db.query("ROLLBACK"); await db.end(); }
}
main().catch(error => { console.error("Schema consistency failed:", error.message); process.exitCode = 1; });
