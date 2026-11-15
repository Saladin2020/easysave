#!/usr/bin/env node
/**
 * Studio CLI wrapper around Easy Save (check / slots / migrate / extract / strings / export without MCP).
 *
 * Usage:
 *   node /workspace/indie-studio/tools/easysave-cli.mjs <command> [options]
 *
 * Install:  EASYSAVE_HOME, else this folder's easysave/
 * The sample lives in the install (init copies it). Game schemas, saves, strings and exports may be written under
 * /workspace/indie-studio/projects/<Name> (pre-allowed).
 * export --out (single preset) writes into that folder without deleting stale files; use a dedicated folder.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(process.env.EASYSAVE_HOME?.trim() || path.join(here, "easysave"));
const STUDIO_PROJECTS = path.resolve(here, "..", "projects");
const cli = path.join(HOME, "dist", "cli.js");

if (!existsSync(cli)) {
  console.error(`Easy Save CLI not found at ${cli}. Set EASYSAVE_HOME and run npm ci && npm run build there.`);
  process.exit(1);
}

const env = {
  ...process.env,
  EASYSAVE_HOME: HOME,
  EASYSAVE_WORKSPACE: process.env.EASYSAVE_WORKSPACE?.trim() || HOME,
};
const allowed = new Set(
  (env.EASYSAVE_ALLOWED_DIRS ?? "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean),
);
allowed.add(STUDIO_PROJECTS);
env.EASYSAVE_ALLOWED_DIRS = [...allowed].join(path.delimiter);

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: HOME,
  stdio: "inherit",
  env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
