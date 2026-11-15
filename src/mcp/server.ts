#!/usr/bin/env node
/**
 * Easy Save MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8899
 *
 * Env: EASYSAVE_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "node:http";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { defaults, migrate, normalize } from "../core/schema.js";
import { readSlot, verifySlot } from "../core/slot.js";
import { LOCALES, MIGRATION_OPS, FIELD_TYPES, type Locale } from "../core/types.js";
import { checkStrings } from "../shared/strings.js";
import { fontNotesText } from "../shared/fonts.js";
import { EXPORT_PRESETS, exportSave } from "../lib/export.js";
import { STRINGS_EXT, checkWorkspace, extractInto, loadConfig, loadSchema, loadStrings, missingKeys, resolveWorkspace, saveSchema, saveStore, writeStrings } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = ["workspace_info", "get_schema", "write_schema", "list_slots", "validate_save", "migrate_save", "list_strings", "set_strings", "extract_strings", "check_all", "export_save"] as const;

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const err = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: message }] });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LocaleSchema = z.enum(LOCALES);

export const FORMAT_CHEATSHEET = `Schema schemas/<id>.easysave.json: { format "easysave/1", id, name? {th,en,ms?}, version (int ≥1), slots { manual n, quick?, autosave? { intervalSec, keep } }, fields { name: Field }, migrations? [{ from, to (= from+1), note?, ops [...] }] }
  Field: { type ${FIELD_TYPES.join("|")}, default?, min?, max?, values? (enum), of? Field (list/map), fields? (object), desc? }
  Migration op: { op ${MIGRATION_OPS.join("|")}, from?/to? (rename, copy), path?, value? (add/set), values? {old: new} (map) } — dotted paths, \`*\` = every list index / map key.
Save saves/<slot>.save.json: { format "easysave-slot/1", game, version, slot, meta { savedAt, playtime, label?, locale? }, data, checksum } — checksum = FNV-1a 32 of canonical JSON {game, version, meta, data} (sorted keys, ints as ints, floats rounded to 6 places). Slot name is not covered so files can move between slots.
Strings strings/<table>.easyi18n.json: { format "easyi18n/1", id, source "th", locales [th,en,ms], strings { key: { th, en?, ms?, note?, src?, stale? [locales], max?, fixed? } } } — keys a-z0-9_.- ; placeholders {name} must match the source. Runtime fallback: locale → en → th.
Extraction keys: dlg.<doc>.<line>, quest.<quest>.title, ui.<doc>.<screen>.<widget>, item.<id>.name … from sources/*.ezd|.dialogue.json|.ezq|.easyui.json|.easyitems.json.
Content rules: no Quran or Arabic calligraphy, no sacred figures, no pork or alcohol in Muslim shops; keep text multicultural (Thai village + Muslim community).`;

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8899, host: "127.0.0.1", workspace: process.env.EASYSAVE_WORKSPACE ?? process.env.EASYSAVE_HOME ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasySaveMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easysave", version: "0.1.0" });

  server.registerTool(
    "workspace_info",
    { title: "Workspace info", description: "Summarize the Easy Save workspace: schemas, save files, string tables with coverage, and the file formats. Call this first.", inputSchema: {} },
    async () => {
      const r = await checkWorkspace(root);
      return text({ name: "easysave", root, config: await loadConfig(root), schemas: r.schemas.map((s) => ({ id: s.id, version: s.version })), saves: r.saves.map((s) => ({ id: s.id, ok: s.ok, version: s.version, reason: s.reason })), strings: { tables: r.strings.tables, keys: r.strings.keys, coverage: r.strings.coverage }, exportPresets: EXPORT_PRESETS, format: FORMAT_CHEATSHEET, fonts: fontNotesText() });
    },
  );

  server.registerTool(
    "get_schema",
    { title: "Get schema", description: "The save schema in full plus the data a fresh save starts with (defaults).", inputSchema: { id: z.string().optional() } },
    async ({ id }) => {
      try {
        const schema = await loadSchema(root, id);
        return text({ schema, defaults: defaults(schema) });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_schema",
    { title: "Write schema", description: "Validate and write schemas/<id>.easysave.json. Bump version and add a migration { from, to, ops } whenever saved data changes shape, so old saves still load. dryRun only validates.", inputSchema: { id: z.string(), schema: z.record(z.string(), z.unknown()), dryRun: z.boolean().optional() } },
    async ({ id, schema, dryRun }) => {
      try {
        const r = await saveSchema(root, id, schema, { dryRun });
        return r.ok ? text({ ok: true, written: !dryRun, file: r.file, diagnostics: r.diagnostics }) : { ...err(`not written:\n${r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.path}: ${d.message}`).join("\n")}`) };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "list_slots",
    { title: "List slots", description: "Every slot the schema defines (manual, quick, autosave) with status from saves/: empty, ok (version, label, savedAt) or the load failure reason.", inputSchema: {} },
    async () => {
      try {
        return text({ slots: (await saveStore(root)).list() });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "validate_save",
    { title: "Validate save", description: "Check a save file (JSON object or text): checksum, game id, version, migration and field types. Returns the loaded data.", inputSchema: { save: z.union([z.string(), z.record(z.string(), z.unknown())]) } },
    async ({ save }) => {
      try {
        const raw = typeof save === "string" ? JSON.parse(save) : save;
        return text({ checksum: verifySlot(raw), result: readSlot(await loadSchema(root), raw) });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "migrate_save",
    { title: "Migrate save data", description: "Run the schema migrations on raw save data written at an older version and normalise it (defaults filled, unknown fields dropped). Nothing is written.", inputSchema: { data: z.record(z.string(), z.unknown()), version: z.number().int().min(1) } },
    async ({ data, version }) => {
      try {
        const schema = await loadSchema(root);
        const m = migrate(schema, data, version);
        if (!m.ok) return err(m.error ?? "migration failed");
        const n = normalize(schema, m.data);
        return text({ ok: !n.diagnostics.some((d) => d.severity === "error"), steps: m.steps, data: n.data, diagnostics: n.diagnostics });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "list_strings",
    { title: "List strings", description: "String table entries (th/en/ms, note, stale) filtered by table, key prefix or missing locale, plus coverage.", inputSchema: { table: z.string().optional(), prefix: z.string().optional(), missing: LocaleSchema.optional(), limit: z.number().int().min(1).max(1000).optional() } },
    async ({ table, prefix, missing, limit }) => {
      const docs = (await loadStrings(root)).filter((d) => !table || d.id === table);
      const c = checkStrings(docs.map((d) => ({ file: `${d.id}${STRINGS_EXT}`, doc: d })));
      const rows = docs.flatMap((d) => Object.entries(d.strings).filter(([k, e]) => (!prefix || k.startsWith(prefix)) && (!missing || (!e.fixed && !e[missing]))).map(([key, e]) => ({ table: d.id, key, ...e })));
      return text({ coverage: c.coverage, total: rows.length, strings: rows.slice(0, limit ?? 200) });
    },
  );

  server.registerTool(
    "set_strings",
    { title: "Set strings", description: "Set translations: [{ key, locale, text }] (table found by key; empty text clears). Clears the stale flag for that locale. Placeholders {name} must match the Thai source.", inputSchema: { entries: z.array(z.object({ key: z.string(), locale: LocaleSchema, text: z.string() })).min(1).max(500) } },
    async ({ entries }) => {
      const docs = await loadStrings(root);
      const unknown: string[] = [];
      const touched = new Set<string>();
      for (const x of entries) {
        const d = docs.find((t) => x.key in t.strings);
        if (!d) {
          unknown.push(x.key);
          continue;
        }
        const e = d.strings[x.key]!;
        if (x.text) e[x.locale as Locale] = x.text;
        else delete e[x.locale as Locale];
        if (e.stale) {
          e.stale = e.stale.filter((l) => l !== x.locale);
          if (!e.stale.length) delete e.stale;
        }
        touched.add(d.id);
      }
      const results = [];
      for (const id of touched) {
        const r = await writeStrings(root, docs.find((d) => d.id === id)!);
        results.push({ table: id, ok: r.ok, errors: r.diagnostics.filter((d) => d.severity === "error") });
      }
      const bad = results.filter((r) => !r.ok);
      return bad.length ? err(JSON.stringify({ notWritten: bad, unknown }, null, 2)) : text({ ok: true, tables: [...touched], unknown });
    },
  );

  server.registerTool(
    "extract_strings",
    { title: "Extract strings", description: "Extract text from sources/ (Easy Dialogue .ezd/.dialogue.json, Easy Quest .ezq, Easy UI .easyui.json, Easy Items .easyitems.json) into the string tables. Changed source text marks translations stale. prune removes keys no source produces.", inputSchema: { prune: z.boolean().optional(), dryRun: z.boolean().optional() } },
    async ({ prune, dryRun }) => {
      try {
        const r = await extractInto(root, { prune, dryRun });
        return text({ files: r.files, tables: Object.fromEntries(Object.entries(r.tables).map(([t, x]) => [t, { total: x.total, added: x.added, changed: x.changed, orphans: x.orphans }])), errors: r.errors, written: !dryRun });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "check_all",
    { title: "Check workspace", description: "Check schemas, every save file and the string tables (placeholders, Thai text in en/ms, length limits, stale). strict makes missing translations errors.", inputSchema: { strict: z.boolean().optional() } },
    async ({ strict }) => {
      const r = await checkWorkspace(root, { strict });
      const mk = await missingKeys(root);
      const strDiag = r.strings.diagnostics.filter((d) => d.severity !== "info");
      return text({ ok: r.ok, schemas: r.schemas, saves: r.saves.map((s) => ({ id: s.id, ok: s.ok, checksum: s.checksum, reason: s.reason, migratedFrom: s.migratedFrom, errors: s.diagnostics.filter((d) => d.severity === "error") })), strings: { coverage: r.strings.coverage, errors: strDiag.filter((d) => d.severity === "error"), warnings: strDiag.filter((d) => d.severity === "warning").length }, sourceKeysMissing: mk.missing.map((m) => m.key).slice(0, 50) });
    },
  );

  server.registerTool(
    "export_save",
    { title: "Export", description: `Export: godot (SaveManager + I18n autoloads, translations CSV, demo, headless test), web (localStorage + i18n runtime, demo), strings (CSV / PO for translators), all. Output goes to exports/ (or a folder inside the workspace).`, inputSchema: { preset: z.enum(EXPORT_PRESETS).optional(), out: z.string().optional() } },
    async ({ preset, out }) => {
      try {
        const r = await exportSave(root, { preset, out });
        return text({ ...r, files: r.files.length });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasySaveMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest({ bindHost: host, token }, { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easysave-token"] as string | undefined) });
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easysave", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasySaveMcp(workspace);
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id: string) => void sessions.set(id, transport!) });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy Save MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
