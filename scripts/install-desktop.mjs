#!/usr/bin/env node
/**
 * Install clickable desktop launchers for Caribou Hub (Linux / freedesktop).
 *
 * Builds the app once, then writes "Caribou Hub" (start) and "Caribou Hub (Stop)"
 * entries into ~/.local/share/applications so they appear in your app grid /
 * launcher search. Exec paths are absolute (this node binary + the scripts), so
 * clicking works regardless of nvm/PATH.
 *
 * Run: pnpm app:install
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

if (process.platform !== "linux") {
  console.error("[install] This installer targets Linux (.desktop). On macOS/Windows, use `pnpm app` or create a shortcut to it.");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const icon = path.join(repoRoot, "client", "public", "caribou-logo.png");
const appsDir = path.join(os.homedir(), ".local", "share", "applications");
const serverEntry = path.join(repoRoot, "dist", "index.js");

// Build once so clicking the launcher never has to (and never needs pnpm on PATH).
if (!fs.existsSync(serverEntry)) {
  console.log("[install] building the app (one-time)…");
  const res = spawnSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
  if (res.status !== 0 || !fs.existsSync(serverEntry)) {
    console.error("[install] build failed — fix the build, then re-run `pnpm app:install`.");
    process.exit(1);
  }
}

fs.mkdirSync(appsDir, { recursive: true });

// Desktop Entry Exec args containing reserved chars (e.g. spaces — this repo path
// has them) must be double-quoted, with " $ ` \ escaped. Without this the path
// splits into separate args and the launcher never starts.
const execArg = (s) => `"${s.replace(/(["$`\\])/g, "\\$1")}"`;
const execLine = (...args) => args.map(execArg).join(" ");

function writeDesktop(filename, fields) {
  const body =
    "[Desktop Entry]\n" +
    Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n";
  const dest = path.join(appsDir, filename);
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return dest;
}

const start = writeDesktop("caribou-hub.desktop", {
  Type: "Application",
  Name: "Caribou Hub",
  Comment: "Project Caribou ground station — boots the local server and opens it in your browser",
  Exec: execLine(node, path.join(repoRoot, "scripts", "launch.mjs")),
  Icon: icon,
  Terminal: "false",
  Categories: "Utility;",
  Keywords: "caribou;drone;uav;ground station;telemetry;",
  StartupNotify: "true",
});

const stop = writeDesktop("caribou-hub-stop.desktop", {
  Type: "Application",
  Name: "Caribou Hub (Stop)",
  Comment: "Stop the running Caribou Hub server",
  Exec: execLine(node, path.join(repoRoot, "scripts", "stop.mjs")),
  Icon: icon,
  Terminal: "false",
  Categories: "Utility;",
  StartupNotify: "false",
});

// Refresh the launcher cache (best-effort).
spawnSync("update-desktop-database", [appsDir], { stdio: "ignore" });

console.log("[install] Installed desktop launchers:");
console.log(`  • ${start}`);
console.log(`  • ${stop}`);
console.log("");
console.log('Open your app launcher and search "Caribou Hub" — click it to start + open in the browser.');
console.log("Tip: to also drop it on your Desktop:");
console.log(`  cp "${start}" ~/Desktop/ && gio set ~/Desktop/caribou-hub.desktop metadata::trusted true`);
