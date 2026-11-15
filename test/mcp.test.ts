import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasySaveMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasySaveMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  return { error: !!r.isError, text: r.content[0]!.text, json: () => JSON.parse(r.content[0]!.text) };
};

describe("MCP server", () => {
  it("lists the tools", async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("info → schema → slots → validate → migrate → strings → extract → check → export", async () => {
    const info = (await call("workspace_info")).json();
    expect(info.schemas).toEqual([{ id: "village_delivery", version: 3 }]);
    expect(info.format).toMatch(/Content rules/);

    const s = (await call("get_schema")).json();
    expect(s.schema.version).toBe(3);
    const bad = await call("write_schema", { id: "village_delivery", schema: { ...s.schema, version: 0 }, dryRun: true });
    expect(bad.error).toBe(true);

    const slots = (await call("list_slots")).json();
    expect(slots.slots.filter((x: { exists: boolean }) => x.exists).map((x: { slot: string }) => x.slot)).toEqual(["slot_1", "slot_2", "auto_0"]);

    const raw = await readFile(path.join(root, "saves/slot_1.save.json"), "utf8");
    const v = (await call("validate_save", { save: raw })).json();
    expect(v.checksum.ok).toBe(true);
    expect(v.result.migratedFrom).toBe(1);
    const tampered = (await call("validate_save", { save: raw.replace('"coins": 15', '"coins": 9999') })).json();
    expect(tampered.result.reason).toBe("checksum");

    const m = (await call("migrate_save", { data: JSON.parse(raw).data, version: 1 })).json();
    expect(m.ok).toBe(true);
    expect(m.data.player.money).toBe(15);

    const missing = (await call("list_strings", { table: "dialogue", missing: "ms", limit: 5 })).json();
    expect(missing.total).toBeGreaterThan(0);
    const key = missing.strings[0].key as string;
    const set = await call("set_strings", { entries: [{ key, locale: "ms", text: "Assalamualaikum, jiran!" }] });
    expect(set.error).toBe(false);
    const ph = await call("set_strings", { entries: [{ key: "save.slot", locale: "ms", text: "Slot {nombor}" }] });
    expect(ph.error).toBe(true);

    const ex = (await call("extract_strings", { dryRun: true })).json();
    expect(Object.keys(ex.tables).sort()).toEqual(["dialogue", "items", "quests", "ui"]);

    const chk = (await call("check_all")).json();
    expect(chk.ok).toBe(true);
    expect(chk.strings.errors).toEqual([]);

    const exp = (await call("export_save", { preset: "strings" })).json();
    expect(exp.files).toBeGreaterThan(3);
    expect((await call("export_save", { preset: "web", out: "/etc/x" })).error).toBe(true);
  });
});

describe("HTTP API", () => {
  it("serves the editor API and guards cross-origin writes", async () => {
    const app = createApp({ workspaceRoot: root });
    const h = { host: "127.0.0.1:8898" };
    const ws = (await (await app.request("/api/workspace", { headers: h })).json()) as any;
    expect(ws.schemas[0].id).toBe("village_delivery");
    const slots = (await (await app.request("/api/slots", { headers: h })).json()) as any;
    expect(slots.slots.length).toBe(6);
    const save = await app.request("/api/slots/slot_3", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ label: "จาก API" }) });
    expect(save.status).toBe(200);
    const got = (await (await app.request("/api/slots/slot_3", { headers: h })).json()) as any;
    expect(got.result.ok).toBe(true);
    expect(got.file.meta.label).toBe("จาก API");
    const evil = await app.request("/api/slots/slot_3", { method: "DELETE", headers: { ...h, origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    const set = await app.request("/api/strings/save_ui/set", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ key: "save.title", locale: "ms", text: "Simpan" }) });
    expect(set.status).toBe(200);
    const csv = await app.request("/api/strings.csv", { headers: h });
    expect(await csv.text()).toMatch(/^keys,th,en,ms/);
    expect((await app.request("/api/po/ms", { headers: h })).status).toBe(200);
  });
});
