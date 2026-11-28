/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { spawnNextInstance, stopChild, writeHermeticTmdbPreload } = require("./two-instance-qualification.cjs");

async function availablePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function canConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", error => error.code === "ECONNREFUSED" ? resolve(false) : reject(error));
    socket.setTimeout(500, () => socket.destroy(new Error("Next port probe timed out")));
  });
}

function processInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], start: fields[19] };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

function rememberChildren(proc, children) {
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) return;
  try {
    const pids = execFileSync("ps", ["--no-headers", "-o", "pid=", "--ppid", String(proc.child.pid)], { encoding: "utf8" });
    for (const pid of pids.trim().split(/\s+/).filter(Boolean).map(Number)) {
      const info = processInfo(pid);
      if (info) children.set(pid, info.start);
    }
  } catch (error) {
    if (error.status !== 1) throw error; // ps returns 1 when the parent has no live children.
  }
}

test("Gate B stops the forked Next server, drains output, and can reuse its port", {
  skip: process.platform !== "linux",
  timeout: 90_000,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cine084-next-"));
  const instances = [];
  const children = new Map();
  const preload = path.join(root, "tmdb preload.cjs");
  writeHermeticTmdbPreload(preload);
  const env = {
    PATH: process.env.PATH,
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--require="${preload}"`,
  };

  const start = async (name, port) => {
    const cwd = path.join(root, name);
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(path.join(cwd, "pages"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name, private: true }));
      fs.writeFileSync(path.join(cwd, "pages", "index.js"), "export default function Page() { return null; }\n");
      fs.symlinkSync(path.resolve(__dirname, "../../node_modules"), path.join(cwd, "node_modules"), "dir");
    }
    const proc = spawnNextInstance({ cwd, port, env });
    instances.push(proc);
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && proc.child.exitCode === null && proc.child.signalCode === null) {
      if (proc.getLogs().includes("Ready in") && await canConnect(port)) {
        rememberChildren(proc, children);
        return proc;
      }
      await delay(50);
    }
    assert.fail(`next dev did not become ready: ${proc.getLogs()}`);
  };

  try {
    const port = await availablePort();
    const first = await start("first", port);
    const firstChildren = [...children.keys()];
    assert.ok(firstChildren.length > 0, "next dev forked a server");
    const otherPort = await availablePort();
    await start("other", otherPort);

    const closed = once(first.child, "close", { signal: AbortSignal.timeout(3_000) });
    const [status, stop] = await Promise.allSettled([closed, stopChild(first)]);
    assert.equal(await canConnect(port), false, "stopped Next server still accepts connections");
    assert.equal(status.status, "fulfilled", "Next stdout and stderr did not drain within 3 seconds");
    assert.deepEqual(stop, { status: "fulfilled", value: true });
    assert.equal(first.child.signalCode, "SIGKILL", "Gate B still exercises a hard stop");
    assert.equal(first.child.stdout.readableEnded, true);
    assert.equal(first.child.stderr.readableEnded, true);
    for (const pid of firstChildren) {
      const info = processInfo(pid);
      assert.ok(!info || info.start !== children.get(pid) || info.state === "Z", "forked Next process is still live");
    }
    assert.equal(await canConnect(otherPort), true, "stopping one instance affected the other");
    await start("first", port);
    t.diagnostic("Both output streams drained within 3 seconds, the fork exited, and restart reused the original port.");
  } finally {
    for (const proc of instances) rememberChildren(proc, children);
    await Promise.allSettled(instances.map(stopChild));
    // Clean up the known fork if the baseline or a regression leaves it alive.
    for (const [pid, start] of children) {
      const info = processInfo(pid);
      if (info?.start === start && info.state !== "Z") {
        try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
