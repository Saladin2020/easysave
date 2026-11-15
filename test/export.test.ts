import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "../src/shared/csv.js";
import { exportSave } from "../src/lib/export.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

const read = (f: string) => readFile(f, "utf8");

describe("export", () => {
  it("all presets write the expected files", async () => {
    const r = await exportSave(root, { preset: "all" });
    expect(r.dirs.map((d) => path.basename(d))).toEqual(["easysave-godot", "easysave-web", "easysave-strings"]);
    expect(r.keys).toBe(322);
    expect(r.saves).toBe(3);
    const ex = (rel: string) => existsSync(path.join(root, "exports", rel));
    for (const f of ["easysave-godot/project.godot", "easysave-godot/easysave/save_manager.gd", "easysave-godot/easysave/i18n.gd", "easysave-godot/easysave/i18n/strings.csv", "easysave-godot/test_save.gd", "easysave-godot/main.tscn", "easysave-web/index.html", "easysave-web/easysave-web.js", "easysave-web/easysave-core.js", "easysave-web/saves/index.json", "easysave-strings/strings.csv", "easysave-strings/en.po", "easysave-strings/ms.po"]) expect(ex(f), f).toBe(true);
  });

  it("Godot CSV has every cell filled (fallbacks), translator CSV leaves blanks", async () => {
    const g = parseCsv(await read(path.join(root, "exports/easysave-godot/easysave/i18n/strings.csv")));
    expect(g[0]).toEqual(["keys", "th", "en", "ms"]);
    expect(g.slice(1).every((row) => row.slice(1).every((c) => c !== ""))).toBe(true);
    const t = parseCsv(await read(path.join(root, "exports/easysave-strings/strings.csv")));
    expect(t.slice(1).some((row) => row.slice(1).some((c) => c === ""))).toBe(true);
  });

  it("project.godot registers the autoloads, translations and the Thai font", async () => {
    const p = await read(path.join(root, "exports/easysave-godot/project.godot"));
    expect(p).toMatch(/SaveManager="\*res:\/\/easysave\/save_manager\.gd"/);
    expect(p).toMatch(/I18n="\*res:\/\/easysave\/i18n\.gd"/);
    expect(p).toMatch(/strings\.th\.translation/);
    expect(p).toMatch(/Kanit/);
  });

  it("web export ships the checked-in runtime unchanged", async () => {
    for (const f of ["easysave-core.js", "easysave-web.js"]) expect(await read(path.join(root, "exports/easysave-web", f))).toBe(await read(path.resolve(__dirname, "../runtime/web", f)));
    const idx = JSON.parse(await read(path.join(root, "exports/easysave-web/saves/index.json")));
    expect(idx.sort()).toEqual(["auto_0", "slot_1", "slot_2"]);
  });

  it("refuses output outside the workspace unless trusted", async () => {
    await expect(exportSave(root, { preset: "web", out: "/tmp/../etc/easysave" })).rejects.toThrow();
  });
});
