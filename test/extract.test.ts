import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractDialogueJson, extractEzd, extractEzq, extractFile, extractItems, extractUi } from "../src/shared/extract.js";
import { extractInto, loadStrings, missingKeys } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

const fx = (f: string) => readFile(path.resolve(__dirname, "fixtures", f), "utf8");
const sample = (f: string) => readFile(path.resolve(__dirname, "../samples/sources", f), "utf8");

describe("extraction", () => {
  it(".ezd line ids match the ids Easy Dialogue compiles (auto node_N / node_cN and explicit #line:)", async () => {
    const fromEzd = extractEzd("tvd_delivery.ezd", await fx("tvd_delivery.ezd"));
    const fromJson = extractDialogueJson("tvd_delivery.dialogue.json", JSON.parse(await fx("tvd_delivery.dialogue.json")));
    const a = new Map(fromEzd.map((e) => [e.key, e.text]));
    const b = new Map(fromJson.map((e) => [e.key, e.text]));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [k, v] of b) expect(a.get(k), k).toBe(v);
    expect(a.size).toBeGreaterThan(40);
    expect([...a.keys()].every((k) => k.startsWith("dlg.tvd_delivery."))).toBe(true);
  });

  it("quests, UI and items produce stable keys", async () => {
    const q = extractEzq("sources/quests/village_delivery.ezq", await sample("quests/village_delivery.ezq"));
    expect(q.some((e) => /^quest\.[a-z_]+\.title$/.test(e.key))).toBe(true);
    const ui = extractUi("sources/ui/village.easyui.json", JSON.parse(await sample("ui/village.easyui.json")));
    expect(ui.every((e) => e.key.startsWith("ui.village."))).toBe(true);
    const items = extractItems("sources/items/raya.easyitems.json", JSON.parse(await sample("items/raya.easyitems.json")));
    const ketupat = items.find((e) => e.key === "item.ketupat.name");
    expect(ketupat?.text).toBeTruthy();
    expect(ketupat?.en).toBeTruthy();
    expect(() => extractFile("x.txt", "")).not.toThrow();
  });

  it("the sample workspace is fully extracted: no missing keys, no orphans; re-extracting changes nothing", async () => {
    const { root, cleanup } = await tempWorkspace();
    try {
      expect(await missingKeys(root)).toEqual({ missing: [], orphans: [] });
      const before = JSON.stringify(await loadStrings(root));
      const r = await extractInto(root);
      for (const t of Object.values(r.tables)) expect(t.added.length + t.changed.length + t.filled.length).toBe(0);
      expect(JSON.stringify(await loadStrings(root))).toBe(before);
    } finally {
      await cleanup();
    }
  });
});
