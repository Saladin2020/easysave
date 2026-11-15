import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSchema, defaults, expand, migrate, normalize } from "../src/core/schema.js";
import { makeSlot, readSlot } from "../src/core/slot.js";
import type { Schema, SlotFile } from "../src/core/types.js";

const samples = path.resolve(__dirname, "../samples");
const loadJson = async <T>(f: string) => JSON.parse(await readFile(path.join(samples, f), "utf8")) as T;

describe("schema", () => {
  it("the sample schema is valid and its defaults pass it", async () => {
    const raw = await loadJson<Schema>("schemas/village_delivery.easysave.json");
    const r = checkSchema(raw, "village_delivery.easysave.json");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const d = defaults(r.schema!);
    expect(normalize(r.schema!, d).diagnostics.filter((x) => x.severity !== "info")).toEqual([]);
    expect((d.player as { money: number }).money).toBeTypeOf("number");
  });

  it("rejects broken schemas with paths", () => {
    const r = checkSchema({ format: "easysave/1", id: "x", version: 2, slots: { manual: 0 }, fields: { a: { type: "nope" } }, migrations: [{ from: 1, to: 3, ops: [{ op: "explode" }] }] }, "x.easysave.json");
    const msgs = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.path);
    expect(msgs.some((p) => p.includes("fields.a"))).toBe(true);
    expect(msgs.some((p) => p.includes("migrations"))).toBe(true);
    expect(r.schema).toBeUndefined();
  });

  it("expands wildcards over lists and maps, keeps missing segments for add/set", () => {
    const data = { a: [{ x: 1 }, { x: 2 }], m: { k1: { y: 1 }, k2: { y: 2 } } };
    expect(expand(data, "a.*.x").map((e) => e.parts.join("."))).toEqual(["a.0.x", "a.1.x"]);
    expect(expand(data, "m.*.y").map((e) => e.parts.join("."))).toEqual(["m.k1.y", "m.k2.y"]);
    expect(expand(data, "new.deep.path").map((e) => e.parts.join("."))).toEqual(["new.deep.path"]);
  });

  it("migrates the v1 sample save to v3 (rename, wrap, add, map, delete, copy, wildcards)", async () => {
    const schema = (await loadJson<Schema>("schemas/village_delivery.easysave.json"));
    const save = await loadJson<SlotFile>("saves/slot_1.save.json");
    const m = migrate(schema, save.data, 1);
    expect(m.ok).toBe(true);
    expect(m.steps.map((s) => `${s.from}>${s.to}`)).toEqual(["1>2", "2>3"]);
    const r = readSlot(schema, save);
    expect(r.ok).toBe(true);
    expect(r.migratedFrom).toBe(1);
    const d = r.data as Record<string, any>;
    expect(d.player.money).toBe(15);
    expect(d.player.pos).toEqual({ x: 212.5, y: 96 });
    expect(d.player.debug).toBeUndefined();
    expect(d.flags).toEqual({ met_vendor: true, met_monk: true, met_farmer: false });
    expect(d.deliveries.map((x: { to: string; done: boolean }) => `${x.to}:${x.done}`)).toEqual(["monk:false", "farmer:false", "elder:false"]);
    expect(d.quests.active).toEqual(["village_delivery"]);
    expect(d.settings.text_speed).toBe(3);
  });

  it("normalize fills defaults, drops unknown fields and reports type and range errors", async () => {
    const schema = await loadJson<Schema>("schemas/village_delivery.easysave.json");
    const n = normalize(schema, { player: { money: 5.0, extra: 1 }, day: "two", settings: { music: 4 } });
    const by = (sev: string) => n.diagnostics.filter((d) => d.severity === sev).map((d) => d.path);
    expect((n.data.player as { money: unknown }).money).toBe(5);
    expect((n.data.player as Record<string, unknown>).extra).toBeUndefined();
    expect(by("warning")).toContain("player.extra");
    expect(by("error")).toEqual(expect.arrayContaining(["day", "settings.music"]));
    expect(by("info").length).toBeGreaterThan(0);
  });

  it("refuses saves from a newer version and other games", async () => {
    const schema = await loadJson<Schema>("schemas/village_delivery.easysave.json");
    const save = await loadJson<SlotFile>("saves/slot_2.save.json");
    expect(readSlot(schema, { ...save, game: "other" }).reason).toBe("checksum"); // game is covered by the checksum
    expect(readSlot(schema, makeSlot({ ...schema, id: "other" }, "slot_1", save.data, save.meta)).reason).toBe("wrong_game");
    expect(readSlot(schema, makeSlot({ ...schema, version: 4 }, "slot_1", save.data, save.meta)).reason).toBe("too_new");
    expect(readSlot(schema, { ...save, data: { ...save.data, day: 99 } }).reason).toBe("checksum");
    expect(readSlot(schema, null).reason).toBe("not_a_save");
  });
});
