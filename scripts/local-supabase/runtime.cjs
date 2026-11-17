/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const { execFileSync } = require("node:child_process");
const { validateBindings, validateHostListeners, assertNoCloudTargetEnv } = require("./safety.cjs");
const run = (program, args) => execFileSync(program, args, { encoding: "utf8" }).trim();

function parseLinuxListeners(output) {
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const localAddr = cols[3];
    if (!localAddr) continue;
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;
    const rawHost = localAddr.slice(0, lastColon).replace(/^\[|\]$/g, "");
    const port = Number(localAddr.slice(lastColon + 1));
    if (Number.isInteger(port)) {
      listeners.push({ address: rawHost === "*" ? "0.0.0.0" : rawHost, port });
    }
  }
  return listeners;
}

function assertLocalStack() {
  assertNoCloudTargetEnv();
  const ids = run("docker", ["ps", "-q", "--filter", "label=com.docker.compose.project=cinematch-gh52d"]).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 4) throw new Error("Expected exactly four running local Compose containers");
  const containers = ids.map((id) => {
    const inspect = JSON.parse(run("docker", ["inspect", "--format", '{{json .}}', id]));
    return {
      id,
      name: inspect.Name.replace(/^\//, ""),
      project: inspect.Config.Labels["com.docker.compose.project"],
      status: inspect.State?.Status ?? "unknown",
      health: inspect.State?.Health?.Status ?? "none",
      ports: inspect.NetworkSettings.Ports,
    };
  });
  validateBindings(containers);
  if (process.platform === "win32") {
    const command = "@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(54321,55432) } | ForEach-Object { @{ address=$_.LocalAddress; port=$_.LocalPort } }) | ConvertTo-Json -Compress";
    const parsed = JSON.parse(run("powershell.exe", ["-NoProfile", "-Command", command]) || "[]");
    validateHostListeners(Array.isArray(parsed) ? parsed : [parsed], [54321, 55432]);
  } else if (process.platform === "linux") {
    const ssOut = run("ss", ["-H", "-ltn"]);
    validateHostListeners(parseLinuxListeners(ssOut), [54321, 55432]);
  } else {
    throw new Error("Unsupported platform for host listener verification: " + process.platform);
  }
  return containers;
}
module.exports = { assertLocalStack, parseLinuxListeners };
