#!/usr/bin/env node
/**
 * Build a distributable Caribou Hub release tarball.
 *
 * Produces release/caribou-hub-<version>.tar.gz containing everything needed to
 * run the Hub from a download — the prebuilt app (dist/), the DB migrations
 * (drizzle/), the launcher scripts, package.json + lockfile, and an INSTALL.md.
 * It deliberately excludes node_modules and source: the recipient runs
 * `pnpm install --prod` once (which compiles the native better-sqlite3 for their
 * platform), then `pnpm app`. So the tarball is platform-agnostic.
 *
 * Run: pnpm package
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const name = `caribou-hub-${pkg.version}`;
const releaseDir = path.join(repoRoot, "release");
const stageDir = path.join(releaseDir, name);
const tarball = path.join(releaseDir, `${name}.tar.gz`);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

// 1) Build (always, so the artifact is fresh).
console.log("[package] building…");
run("pnpm", ["build"]);
if (!fs.existsSync(path.join(repoRoot, "dist", "index.js"))) {
  throw new Error("build did not produce dist/index.js");
}

// 2) Stage the runtime files.
console.log("[package] staging…");
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

const include = ["dist", "drizzle", "scripts", "package.json", "pnpm-lock.yaml", ".env.example"];
for (const item of include) {
  const src = path.join(repoRoot, item);
  if (!fs.existsSync(src)) {
    console.warn(`[package] skipping missing ${item}`);
    continue;
  }
  fs.cpSync(src, path.join(stageDir, item), { recursive: true });
}

// 3) Generate an INSTALL.md for the recipient.
fs.writeFileSync(
  path.join(stageDir, "INSTALL.md"),
  `# Caribou Hub ${pkg.version} — Install

A self-contained local ground station for Project Caribou. No cloud account and
no database server — it uses an embedded SQLite DB and local file storage, both
created on first run.

## Requirements
- Node.js 22+
- pnpm  (\`npm install -g pnpm\`)

## Install
\`\`\`bash
tar xzf ${name}.tar.gz && cd ${name}
pnpm install --prod        # runtime deps only (compiles better-sqlite3 for this machine)
\`\`\`

## Run
\`\`\`bash
# Desktop app (Linux): adds a clickable "Caribou Hub" launcher, then click it
pnpm app:install

# Or, any platform — start the server and open the browser:
pnpm app
# Stop it:
pnpm app:stop
\`\`\`

First run creates \`./data\` (SQLite DB + uploaded files) and serves the Hub at
http://localhost:3000. See the project README for configuration, companion-computer
setup, and Tailscale remote access.
`
);

// 4) Tar it up.
console.log("[package] creating tarball…");
run("tar", ["czf", tarball, "-C", releaseDir, name]);
fs.rmSync(stageDir, { recursive: true, force: true });

const sizeMb = (fs.statSync(tarball).size / 1e6).toFixed(1);
console.log(`[package] done → ${path.relative(repoRoot, tarball)} (${sizeMb} MB)`);
