/**
 * Optional Godot check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the Godot project, imports it headless twice, then test_save.gd checks canonical JSON + checksum parity
 * with the TypeScript core, verifies the fixture saves (and that the tampered one fails), replays migrations against
 * the TS results, writes / reloads / falls back to .bak / rotates autosaves, and looks up translations through
 * TranslationServer. The save Godot wrote (W| path) is then verified by the TypeScript core.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readSlot, verifySlot } from "../src/core/slot.js";
import { exportSave } from "../src/lib/export.js";
import { loadSchema } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export", () => {
  it("SaveManager and I18n match the TypeScript core", async () => {
    const out = path.join(root, "exports", "godot");
    await exportSave(root, { preset: "godot", out });
    for (let i = 0; i < 2; i++) spawnSync(GODOT!, ["--headless", "--path", out, "--import"], { encoding: "utf8", timeout: 180_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_save.gd"], { encoding: "utf8", timeout: 120_000 });
    expect(run.stdout).not.toMatch(/^FAIL/m);
    expect(run.stdout).toMatch(/^OK$/m);
    expect(run.stdout).toMatch(/^C\| canon ok/m);
    expect(run.stdout).toMatch(/^V\| fixtures=3 tampered=1$/m);
    expect(run.stdout).toMatch(/^S\| save ok backup ok autosave ok$/m);
    expect(run.stdout).toMatch(/^T\| tr ok checks=\d+ imported=true/m);
    const w = /^W\| (.+)$/m.exec(run.stdout)?.[1];
    expect(w).toBeTruthy();
    const file = JSON.parse(await readFile(w!, "utf8"));
    expect(verifySlot(file).ok).toBe(true);
    expect(readSlot(await loadSchema(root), file).ok).toBe(true);
    const main = spawnSync(GODOT!, ["--headless", "--path", out, "--quit-after", "30"], { encoding: "utf8", timeout: 120_000 });
    expect(main.stderr + main.stdout).not.toMatch(/SCRIPT ERROR|Parse Error/);
  }, 600_000);
});
