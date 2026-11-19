/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Windows-first lifecycle controller (start, stop, reset, migrate, seed, health) for local Compose stack.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { ensureStackEnv, ensureAppEnv, STACK_ENV_PATH } = require("./generate-env.cjs");
const { applyCanonicalMigrations } = require("./apply-migrations.cjs");
const { seedSyntheticData } = require("./seed.cjs");
const { runHealthCheck } = require("./health.cjs");
const { assertNoCloudTargetEnv, validateCommit } = require("./safety.cjs");

const COMPOSE_FILE = path.resolve(__dirname, "compose.yml");

function compose(args) {
  assertNoCloudTargetEnv();
  return execFileSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "--env-file", STACK_ENV_PATH, ...args],
    { stdio: "inherit" }
  );
}

function getFlagValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function main() {
  assertNoCloudTargetEnv();
  const [command, ...rest] = process.argv.slice(2);
  const commit = getFlagValue(rest, "--commit");
  const withSeed = rest.includes("--seed");
  const confirmed = rest.includes("--yes");

  if (!command || command === "--help" || command === "-h") {
    console.log(
      "Usage: node ctl.cjs <start|stop|reset|migrate|seed|health> [--commit <40-hex-sha>] [--seed] [--yes]"
    );
    return;
  }

  switch (command) {
    case "start": {
      ensureStackEnv({ force: false });
      ensureAppEnv({ force: false });
      compose(["up", "-d", "--wait"]);
      if (commit) {
        validateCommit(commit);
        const applied = applyCanonicalMigrations(commit);
        for (const item of applied) console.log(item.file, item.hash);
      }
      if (withSeed) {
        console.log(JSON.stringify(await seedSyntheticData()));
      }
      console.log(JSON.stringify(await runHealthCheck(), null, 2));
      break;
    }
    case "stop": {
      ensureStackEnv({ force: false });
      compose(["down"]);
      console.log("Stopped local cinematch-gh52d stack (volume preserved).");
      break;
    }
    case "reset": {
      if (!confirmed) {
        throw new Error("Refusing destructive local volume reset without --yes");
      }
      if (!commit) {
        throw new Error("reset requires --commit <40-hex-sha> for canonical migrations");
      }
      validateCommit(commit);
      ensureStackEnv({ force: false });
      compose(["down", "-v", "--remove-orphans"]);
      compose(["up", "-d", "--wait"]);
      const applied = applyCanonicalMigrations(commit);
      for (const item of applied) console.log(item.file, item.hash);
      if (withSeed) {
        console.log(JSON.stringify(await seedSyntheticData()));
      }
      ensureAppEnv({ force: false });
      console.log(JSON.stringify(await runHealthCheck(), null, 2));
      break;
    }
    case "migrate": {
      if (!commit) throw new Error("migrate requires --commit <40-hex-sha>");
      const applied = applyCanonicalMigrations(commit);
      for (const item of applied) console.log(item.file, item.hash);
      break;
    }
    case "seed": {
      console.log(JSON.stringify(await seedSyntheticData()));
      break;
    }
    case "health":
    case "status": {
      console.log(JSON.stringify(await runHealthCheck(), null, 2));
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error("local-supabase ctl failed:", error.message);
  process.exitCode = 1;
});
