/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

for (const args of [["--reseed"], ["--database", "postgres"], ["--yes"]]) {
  test(`roundtrip refuses unsafe/obsolete options before Docker: ${args.join(" ")}`, () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "migration-roundtrip.cjs"), ...args, "--commit", "invalid"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported roundtrip option/);
  });
}

test("disposable database rejects shared, malformed and injected names without invoking Docker", async () => {
  const { withDisposableDatabase } = require("./disposable-migration-db.cjs");
  for (const name of ["postgres", "template0", "cinematch_roundtrip_existing", 'bad"; DROP DATABASE postgres;--']) {
    await assert.rejects(withDisposableDatabase("local-container", async () => assert.fail("work called"), {
      name, run: () => assert.fail("Docker called"),
    }), /Invalid disposable database name/);
  }
});

test("exclusive create collision never runs work or drops the pre-existing database", async () => {
  const { withDisposableDatabase } = require("./disposable-migration-db.cjs");
  let calls = 0;
  await assert.rejects(withDisposableDatabase("local-container", async () => assert.fail("work called"), {
    name: "cinematch_roundtrip_0123456789abcdef0123456789abcdef",
    run: () => { calls++; throw new Error("database already exists"); },
  }), /already exists/);
  assert.equal(calls, 1);
});

for (const fail of [false, true]) {
  test(`disposable SQL stays in fresh DB; cleanup after ${fail ? "failure" : "success"}`, async () => {
    const { withDisposableDatabase } = require("./disposable-migration-db.cjs");
    const name = "cinematch_roundtrip_0123456789abcdef0123456789abcdef";
    const calls = [];
    const operation = withDisposableDatabase("local-container", async (sql) => {
      sql("SELECT 42");
      if (fail) throw new Error("migration failure");
      return "complete";
    }, { name, run: (program, args, options) => { calls.push({ program, args, input: options.input }); return "42\n"; } });
    if (fail) await assert.rejects(operation, /migration failure/);
    else assert.equal(await operation, "complete");
    assert.equal(calls.length, 3);
    assert.match(calls[0].input, /^CREATE DATABASE "cinematch_roundtrip_[a-f0-9]{32}" WITH TEMPLATE template0/);
    assert.equal(calls[1].args[calls[1].args.indexOf("-d") + 1], name);
    assert.match(calls[2].input, /^DROP DATABASE "cinematch_roundtrip_[a-f0-9]{32}";/);
    assert.equal(calls.some(c => /IF EXISTS|FORCE|DROP.*postgres/i.test(c.input)), false);
  });
}
