"use strict";
const { execFileSync } = require("node:child_process");
const { validateBindings, validateHostListeners } = require("./safety.cjs");
const run = (program, args) => execFileSync(program, args, { encoding: "utf8" }).trim();

function assertLocalStack() {
  const ids = run("docker", ["ps", "-q", "--filter", "label=com.docker.compose.project=cinematch-gh52d"]).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 4) throw new Error("Expected exactly four running local Compose containers");
  const containers = ids.map((id) => {
    const inspect = JSON.parse(run("docker", ["inspect", "--format", '{{json .}}', id]));
    return { id, name: inspect.Name.replace(/^\//, ""), project: inspect.Config.Labels["com.docker.compose.project"], ports: inspect.NetworkSettings.Ports };
  });
  validateBindings(containers);
  if (process.platform !== "win32") throw new Error("Host listener verification currently supports Windows only");
  const command = "@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(54321,55432) } | ForEach-Object { @{ address=$_.LocalAddress; port=$_.LocalPort } }) | ConvertTo-Json -Compress";
  const parsed = JSON.parse(run("powershell.exe", ["-NoProfile", "-Command", command]) || "[]");
  validateHostListeners(Array.isArray(parsed) ? parsed : [parsed], [54321, 55432]);
  return containers;
}
module.exports = { assertLocalStack };
