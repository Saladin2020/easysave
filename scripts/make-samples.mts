/**
 * Regenerate samples/saves/*.save.json and samples/strings/*.easyi18n.json.
 *   npx tsx scripts/make-samples.mts
 * Saves get real checksums; string tables are extracted from samples/sources and filled from
 * scripts/sample-translations.tsv and scripts/save-ui.tsv.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSlot } from "../src/core/slot.js";
import type { Schema, StringsDoc } from "../src/core/types.js";
import { extractFile } from "../src/shared/extract.js";
import { emptyTable, mergeExtracted, sortedTable, type Extracted } from "../src/shared/strings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = (p: string) => path.join(root, "samples", p);
const schema = JSON.parse(readFileSync(S("schemas/village_delivery.easysave.json"), "utf8")) as Schema;
const write = (f: string, v: unknown) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
};

// ---- saves
const v1 = { ...schema, version: 1 };
const v1data = {
  player: { name: "ต้น", coins: 15, x: 212.5, y: 96, debug: true },
  quest: "village_delivery",
  vars: { delivered: 1, coins: 15, mango: false },
  flags: { met_vendor: "yes", met_monk: "yes", met_farmer: "no" },
  orders: [
    { customer: "monk", item: "sticky_rice" },
    { customer: "farmer", item: "morning_glory" },
    { customer: "elder", item: "balm" },
  ],
  settings: { text_speed: "fast", music: 0.6 },
};
write(S("saves/slot_1.save.json"), makeSlot(v1, "slot_1", v1data, { savedAt: "2026-03-02T08:15:00+07:00", playtime: 1260, label: "ตลาดเช้า · old v0.1 save" }));

const v3data = {
  player: { name: "ต้น", money: 25, scene: "elder_house", pos: { x: 344, y: 180.25 }, facing: "left", bike: "rusty" },
  day: 2,
  time_of_day: "evening",
  quests: {
    active: ["help_tomorrow"],
    done: ["village_delivery", "snack_money"],
    steps: { village_delivery: ["accept", "temple", "farm", "mango", "elder", "report"], help_tomorrow: [] },
    vars: { delivered: 3, coins: 25, mango: true, reputation: 1 },
  },
  items: {
    coins: 25,
    day: 2,
    slots: [{ item: "letter", n: 1 }, { item: "kanom_chan", n: 1 }, { item: "mango", n: 2 }, null, null, null],
    equipped: { head: "straw_hat", body: null, hand: null, accessory: "basket", vehicle: null },
    stock: { market: { mango_sticky_rice: 5, mango: 10 } },
    restocked: { market: { mango_sticky_rice: 0, mango: 1 } },
  },
  flags: { met_vendor: true, met_monk: true, met_farmer: true, met_elder: true },
  deliveries: [
    { to: "monk", item: "sticky_rice", done: true },
    { to: "farmer", item: "morning_glory", done: true },
    { to: "elder", item: "balm", done: true },
  ],
  settings: { locale: "th", text_speed: 2, music: 0.7, sfx: 0.8, big_text: false },
  stats: { playtime: 3725, max_money: 25, saves: 4 },
};
write(S("saves/slot_2.save.json"), makeSlot(schema, "slot_2", v3data, { savedAt: "2026-11-15T19:40:00+07:00", playtime: 3725, label: "บ้านตาเพิ่ม · วันที่ 2", locale: "th" }));
const auto = structuredClone(v3data);
auto.player.scene = "market";
auto.time_of_day = "noon";
auto.stats.playtime = 3600;
write(S("saves/auto_0.save.json"), makeSlot(schema, "auto_0", auto, { savedAt: "2026-11-15T19:38:00+07:00", playtime: 3600, label: "autosave" }));

// ---- strings
const tsv = (f: string) =>
  readFileSync(path.join(root, "scripts", f), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split("\t"));
const tr = new Map(tsv("sample-translations.tsv").map(([k, en, ms]) => [k!, { en: en!, ms: ms! }]));

const walk = (d: string): string[] => readdirSync(d).sort().flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const found: Extracted[] = [];
const seen = new Set<string>();
for (const f of walk(S("sources"))) for (const e of extractFile(path.relative(S(""), f).replace(/^sources\//, "sources/"), readFileSync(f, "utf8"))) if (!seen.has(e.key)) (seen.add(e.key), found.push(e));
const tables = new Map<string, StringsDoc>();
for (const e of found) {
  if (!tables.has(e.table)) tables.set(e.table, emptyTable(e.table));
}
for (const [id, doc] of tables) {
  mergeExtracted(doc, found.filter((e) => e.table === id));
  for (const [k, e] of Object.entries(doc.strings)) {
    const t = tr.get(k);
    if (t) {
      e.en = t.en;
      e.ms = t.ms;
    }
  }
  write(S(`strings/${id}.easyi18n.json`), sortedTable(doc));
}
const ui = emptyTable("save_ui");
for (const [k, th, en, ms, note] of tsv("save-ui.tsv")) {
  ui.strings[k!] = th === en && en === ms ? { th: th!, note: note!, fixed: true } : { th: th!, en: en!, ms: ms!, note: note! };
}
ui.strings["save.slot"]!.max = 14;
write(S("strings/save_ui.easyi18n.json"), sortedTable(ui));
const unused = [...tr.keys()].filter((k) => !seen.has(k));
console.log("saves 3 · tables", [...tables.keys(), "save_ui"].join(", "), "· strings", found.length + Object.keys(ui.strings).length, unused.length ? `· unused translations: ${unused.join(", ")}` : "");
