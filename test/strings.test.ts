import { describe, expect, it } from "vitest";
import { I18n, hasThai, thaiWrapHints } from "../src/core/i18n.js";
import type { StringsDoc } from "../src/core/types.js";
import { importCsv, parseCsv, toCsv } from "../src/shared/csv.js";
import { importPo, parsePo, toPo } from "../src/shared/po.js";
import { checkStrings, mergeExtracted } from "../src/shared/strings.js";

const table = (): StringsDoc => ({
  format: "easyi18n/1",
  id: "ui",
  source: "th",
  locales: ["th", "en", "ms"],
  strings: {
    "save.slot": { th: "ช่องที่ {n}", en: "Slot {n}", ms: "Slot {n}" },
    "save.money": { th: "{money} บาท", en: "{money} baht", note: 'with "quotes", commas\nand newline' },
    "shop.buy": { th: "ซื้อ ฿25", en: "Buy ฿25", ms: "Beli ฿25", max: 10 },
    "lang.th": { th: "ไทย", fixed: true },
  },
});
const check = (d: StringsDoc, strict = false) => checkStrings([{ file: "ui.easyi18n.json", doc: d }], { strict });

describe("string tables", () => {
  it("a clean table only warns about missing translations", () => {
    const r = check(table());
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.missing).toEqual([{ table: "ui", key: "save.money", locale: "ms" }]);
    expect(check(table(), true).diagnostics.some((d) => d.severity === "error" && d.message.startsWith("missing"))).toBe(true);
    const cov = r.coverage[0]!;
    expect(cov.total).toBe(4);
    expect(cov.locales.ms!.done).toBe(3); // fixed counts as done
  });

  it("flags placeholder mismatches, Thai in en/ms (baht sign allowed), length and duplicates", () => {
    const d = table();
    d.strings["save.slot"]!.en = "Slot {num}";
    d.strings["save.money"]!.ms = "{money} บาท";
    d.strings["shop.buy"]!.ms = "Beli sekarang ฿25!";
    const r = check(d);
    const msgs = r.diagnostics.map((x) => `${x.severity}:${x.path}:${x.message}`).join("\n");
    expect(msgs).toMatch(/error:.*save\.slot\.en:.*placeholder/);
    expect(msgs).toMatch(/save\.money\.ms:contains Thai script/);
    expect(msgs).not.toMatch(/shop\.buy\.(en|ms):contains Thai/);
    expect(msgs).toMatch(/shop\.buy\.ms:.*max 10/);
    const dup = checkStrings([{ file: "a.easyi18n.json", doc: table() }, { file: "b.easyi18n.json", doc: { ...table(), id: "b" } }]);
    expect(dup.diagnostics.some((x) => x.severity === "error" && /duplicate|also in/.test(x.message))).toBe(true);
    expect(hasThai("฿1,250")).toBe(false);
    expect(hasThai("ไทย")).toBe(true);
  });

  it("CSV round trip keeps quotes, commas, newlines; empty cells never erase", () => {
    const csv = toCsv([table()], ["th", "en", "ms"]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["keys", "th", "en", "ms"]); // Godot translation CSV header
    const d = table();
    const edited = csv.replace("Slot {n},Slot {n}", "Slot {n},Petak {n}");
    const r = importCsv(edited, [d]);
    expect(r.updated).toBe(1);
    expect(d.strings["save.slot"]!.ms).toBe("Petak {n}");
    expect(d.strings["save.money"]!.en).toBe("{money} baht");
    expect(importCsv("key,th,en\nnope.key,x,y\n", [d]).unknown).toEqual(["nope.key"]);
  });

  it("PO round trip (msgctxt = key, msgid = Thai source) and stale detection", () => {
    const po = toPo([table()], "ms");
    const parsed = parsePo(po);
    expect(parsed.locale).toBe("ms");
    expect(parsed.entries.find((e) => e.ctx === "save.money")?.str).toBe("");
    const d = table();
    const r = importPo(po.replace(/(msgctxt "save.money"\nmsgid ".*"\nmsgstr )""/, '$1"{money} baht (RM)"'), [d]);
    expect(r.updated).toBe(1);
    expect(d.strings["save.money"]!.ms).toBe("{money} baht (RM)");
    d.strings["save.slot"]!.th = "ช่อง {n}";
    expect(importPo(po, [d]).sourceChanged).toContain("save.slot");
  });

  it("merging extracted text marks changed sources stale and reports orphans", () => {
    const d = table();
    const src = "sources/ui/x.easyui.json";
    const r = mergeExtracted(d, [
      { key: "save.slot", text: "ช่อง {n}", src, table: "ui" },
      { key: "save.money", text: "{money} บาท", src, table: "ui" },
      { key: "item.mango.name", text: "มะม่วง", en: "Mango", src, table: "ui" },
    ], { prune: true });
    expect(r.added).toEqual(["item.mango.name"]);
    expect(r.changed).toEqual(["save.slot"]);
    expect(d.strings["save.slot"]!.stale).toEqual(["en", "ms"]);
    expect(d.strings["item.mango.name"]!.en).toBe("Mango");
    expect(r.orphans.sort()).toEqual(["lang.th", "shop.buy"]);
    expect(d.strings["shop.buy"]).toBeUndefined();
  });
});

describe("I18n runtime", () => {
  it("falls back locale → en → th → key and fills placeholders", () => {
    const i = new I18n([table()], { locale: "ms" });
    expect(i.t("save.slot", { n: 2 })).toBe("Slot 2");
    expect(i.t("save.money", { money: 25 })).toBe("25 baht");
    expect(i.missing.has("ms:save.money")).toBe(true);
    expect(i.t("lang.th")).toBe("ไทย");
    expect(i.t("no.such.key")).toBe("no.such.key");
    i.setLocale("th");
    expect(i.t("save.slot", { n: 1 })).toBe("ช่องที่ 1");
  });

  it("adds zero-width break hints between Thai words only", () => {
    const s = thaiWrapHints("บันทึกเกมแล้ว");
    expect(s.replace(/\u200b/g, "")).toBe("บันทึกเกมแล้ว");
    expect(s).toContain("\u200b");
    expect(thaiWrapHints("Saved game")).toBe("Saved game");
  });
});
