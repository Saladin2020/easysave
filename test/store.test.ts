import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaults } from "../src/core/schema.js";
import { makeSlot } from "../src/core/slot.js";
import { SaveStore } from "../src/core/store.js";
import type { Schema } from "../src/core/types.js";
import { memStorage } from "./helpers.js";

const schemaP = readFile(path.resolve(__dirname, "../samples/schemas/village_delivery.easysave.json"), "utf8").then((t) => JSON.parse(t) as Schema);
let tick = 0;
const now = () => `2026-11-15T10:00:${String(tick++ % 60).padStart(2, "0")}+07:00`;

describe("SaveStore", () => {
  it("lists the schema's slots", async () => {
    const s = new SaveStore(await schemaP, memStorage());
    expect(s.slots().map((x) => x.slot)).toEqual(["slot_1", "slot_2", "slot_3", "quick", "auto_0", "auto_1"]);
    expect(s.save("slot_9", {}).reason).toBe("bad_slot");
  });

  it("save → load round trip, .bak on overwrite, fallback when the main file is corrupt", async () => {
    const schema = await schemaP;
    const st = memStorage();
    const s = new SaveStore(schema, st, { now });
    const d = defaults(schema) as Record<string, any>;
    d.day = 2;
    expect(s.save("slot_1", d, { label: "a" }).ok).toBe(true);
    expect(s.load("slot_1").data?.day).toBe(2);
    d.day = 3;
    s.save("slot_1", d, { label: "b" });
    expect(s.list().find((x) => x.slot === "slot_1")?.hasBackup).toBe(true);
    st.set(s.key("slot_1"), st.get(s.key("slot_1"))!.replace('"day": 3', '"day": 30'));
    const r = s.load("slot_1");
    expect(r.ok).toBe(true);
    expect(r.usedBackup).toBe(true);
    expect(r.data?.day).toBe(2);
    st.set(s.key("slot_1"), "{ not json");
    expect(s.load("slot_1").usedBackup).toBe(true);
    s.remove("slot_1");
    expect(s.load("slot_1").reason).toBe("empty");
  });

  it("refuses data that breaks the schema", async () => {
    const s = new SaveStore(await schemaP, memStorage());
    const r = s.save("slot_2", { day: "monday" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid");
  });

  it("autosave rotates auto_0 → auto_1 and keeps N", async () => {
    const schema = await schemaP;
    const s = new SaveStore(schema, memStorage(), { now });
    for (const day of [1, 2, 3]) s.autosave({ ...defaults(schema), day });
    expect(s.load("auto_0").data?.day).toBe(3);
    expect(s.load("auto_1").data?.day).toBe(2);
    expect(s.list().filter((x) => x.kind === "auto" && x.exists).length).toBe(2);
    expect(s.autosaveDue(119)).toBe(false);
    expect(s.autosaveDue(120)).toBe(true);
  });

  it("a slot file moved to another slot still verifies (slot name is not in the checksum)", async () => {
    const schema = await schemaP;
    const st = memStorage();
    const s = new SaveStore(schema, st);
    const f = makeSlot(schema, "slot_1", defaults(schema), { savedAt: now() });
    st.set(s.key("slot_3"), JSON.stringify(f));
    expect(s.load("slot_3").ok).toBe(true);
  });
});
