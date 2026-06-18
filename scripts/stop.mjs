#!/usr/bin/env node
/**
 * Stop a Caribou Hub instance started by scripts/launch.mjs.
 * Kills the pid recorded in data/hub.pid (and any process on the configured port
 * as a fallback). Safe to run when nothing is running.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = String(process.env.CARIBOU_PORT || process.env.PORT || "3000");
const pidFile = path.join(repoRoot, "data", "hub.pid");

function notify(body) {
  if (process.platform !== "linux") return;
  try {
    spawnSync("notify-send", ["-a", "Caribou Hub", "Caribou Hub", body], { stdio: "ignore" });
  } catch {
    /* notify-send not installed */
  }
}

let stopped = false;

// 1) pid file
try {
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (pid) {
    process.kill(pid, "SIGTERM");
    console.log(`[stop] sent SIGTERM to pid ${pid}`);
    stopped = true;
  }
} catch {
  /* no pid file / already gone */
}
try {
  fs.rmSync(pidFile, { force: true });
} catch {
  /* ignore */
}

// 2) fallback: anything still bound to the port (covers an auto-bumped/orphaned run)
if (process.platform !== "win32") {
  const res = spawnSync("bash", ["-lc", `lsof -ti tcp:${PORT} 2>/dev/null || ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\\K[0-9]+'`], {
    encoding: "utf8",
  });
  const pids = (res.stdout || "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
  for (const p of pids) {
    try {
      process.kill(Number(p), "SIGTERM");
      console.log(`[stop] sent SIGTERM to pid ${p} (port :${PORT})`);
      stopped = true;
    } catch {
      /* ignore */
    }
  }
}

console.log(stopped ? "[stop] Caribou Hub stopped." : "[stop] nothing to stop.");
notify(stopped ? "Stopped." : "Was not running.");
