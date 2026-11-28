"use strict";

// Next dev forks its server with an IPC channel and inherits this preload. A
// SIGKILL bypasses CLI cleanup, so the fork must stop when that channel closes.
// Keep both processes in the outer qualification supervisor's process group.
if (process.env.NEXT_PRIVATE_WORKER === "1" && typeof process.send === "function") {
  const stop = () => process.kill(process.pid, "SIGKILL");
  if (process.connected) process.once("disconnect", stop);
  else stop();
}
