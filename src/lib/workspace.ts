import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkSchema, defaults, migrate, normalize } from "../core/schema.js";
import { parseSlot, verifySlot } from "../core/slot.js";
import { SaveStore, type SaveStorage } from "../core/store.js";
import { LOCALES, SAFE_ID, type Diagnostic, type Locale, type Schema, type SlotFile, type StringsDoc } from "../core/types.js";
import { extractFile, sourceKind } from "../shared/extract.js";
import { checkStrings, checkStringsShape, emptyTable, mergeExtracted, sortedTable, type Coverage, type Extracted, type MergeReport } from "../shared/strings.js";
import { pkgRoot } from "./assets.js";

export const CONFIG_NAME = "easysave.config.json";
export const SCHEMA_EXT = ".easysave.json";
export const SAVE_EXT = ".save.json";
export const STRINGS_EXT = ".easyi18n.json";

export interface EasySaveConfig {
  name: string;
  /** Folders or files the extractor reads (relative to the workspace). */
  sources: string[];
  locales: Locale[];
  sourceLocale: Locale;
  /** Schema used by the slots / CLI commands when there are several. */
  schema?: string;
}

export const DEFAULT_CONFIG: EasySaveConfig = { name: "Easy Save Workspace", sources: ["sources"], locales: [...LOCALES], sourceLocale: "th" };

export function assertSafeId(id: unknown, label = "id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} ${JSON.stringify(id)} (use a-z, 0-9, _ or -)`);
  return id;
}

export const resolveWorkspace = (dir = process.cwd()) => path.resolve(dir);

export const dirs = (root: string) => ({
  schemas: path.join(root, "schemas"),
  saves: path.join(root, "saves"),
  strings: path.join(root, "strings"),
  sources: path.join(root, "sources"),
  exports: path.join(root, "exports"),
});

export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYSAVE_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  return [path.resolve(root), ...extra];
}

export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const ok = allowedRoots(root).some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error(`Path ${p} is outside the workspace (allow it with EASYSAVE_ALLOWED_DIRS)`);
  return abs;
}

async function copyTree(src: string, dest: string, force: boolean) {
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if ((await stat(s)).isDirectory()) await copyTree(s, d, force);
    else if (!existsSync(d) || force) await copyFile(s, d);
  }
}

export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = resolveWorkspace(dir);
  for (const p of Object.values(dirs(root))) await mkdir(p, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg) || opts.force) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  for (const sub of ["schemas", "saves", "strings", "sources"] as const) {
    const src = path.join(pkgRoot, "samples", sub);
    if (existsSync(src)) await copyTree(src, dirs(root)[sub], !!opts.force);
  }
  return root;
}

export async function loadConfig(root: string): Promise<EasySaveConfig> {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...(JSON.parse(await readFile(f, "utf8")) as Partial<EasySaveConfig>) };
}

async function listJson(dir: string, ext: string): Promise<Array<{ id: string; file: string; raw?: unknown; text?: string; parseError?: string }>> {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of (await readdir(dir)).sort()) {
    if (!f.endsWith(ext)) continue;
    const file = path.join(dir, f);
    const text = await readFile(file, "utf8");
    try {
      out.push({ id: f.slice(0, -ext.length), file, raw: JSON.parse(text), text });
    } catch (e) {
      out.push({ id: f.slice(0, -ext.length), file, text, parseError: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function listSchemas(root: string) {
  return (await listJson(dirs(root).schemas, SCHEMA_EXT)).map((x) => {
    const r = x.parseError ? { diagnostics: [{ path: `${x.id}${SCHEMA_EXT}`, message: `JSON: ${x.parseError}`, severity: "error" as const }] } : checkSchema(x.raw, `${x.id}${SCHEMA_EXT}`);
    return { id: x.id, file: x.file, raw: x.raw, schema: r.schema, diagnostics: r.diagnostics };
  });
}

/** The workspace's schema: config.schema, else the only one, else the first. */
export async function loadSchema(root: string, id?: string): Promise<Schema> {
  const cfg = await loadConfig(root);
  const all = await listSchemas(root);
  const want = id ?? cfg.schema;
  const s = want ? all.find((x) => x.id === want) : all[0];
  if (!s) throw new Error(want ? `No schema "${want}" in ${dirs(root).schemas}` : `No *${SCHEMA_EXT} in ${dirs(root).schemas} (run init)`);
  if (!s.schema) throw new Error(`${s.id}${SCHEMA_EXT}: ${s.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.path} ${d.message}`).join("; ")}`);
  return s.schema;
}

export const schemaPath = (root: string, id: string) => path.join(dirs(root).schemas, `${assertSafeId(id, "schema id")}${SCHEMA_EXT}`);

export async function saveSchema(root: string, id: string, raw: unknown, opts: { dryRun?: boolean } = {}): Promise<{ ok: boolean; file: string; diagnostics: Diagnostic[] }> {
  const file = schemaPath(root, id);
  const r = checkSchema(raw, `${id}${SCHEMA_EXT}`);
  if (r.schema && (raw as Schema).id !== id) r.diagnostics.push({ path: `${id}${SCHEMA_EXT}:id`, message: `id must match the file name ("${id}")`, severity: "error" });
  const ok = !r.diagnostics.some((d) => d.severity === "error");
  if (ok && !opts.dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
  }
  return { ok, file, diagnostics: r.diagnostics };
}

/** SaveStorage over a folder (writes are atomic: temp file + rename). */
export function folderStorage(dir: string): SaveStorage {
  return {
    get: (k) => (existsSync(path.join(dir, k)) ? readFileSync(path.join(dir, k), "utf8") : null),
    set: (k, v) => {
      mkdirSync(dir, { recursive: true });
      const f = path.join(dir, k);
      writeFileSync(`${f}.tmp`, v);
      renameSync(`${f}.tmp`, f);
    },
    remove: (k) => rmSync(path.join(dir, k), { force: true }),
  };
}

export async function saveStore(root: string, schemaId?: string): Promise<SaveStore> {
  return new SaveStore(await loadSchema(root, schemaId), folderStorage(dirs(root).saves));
}

export interface SaveFileReport {
  id: string;
  file: string;
  version?: number;
  slot?: string;
  checksum: "ok" | "bad" | "n/a";
  ok: boolean;
  reason?: string;
  message?: string;
  migratedFrom?: number;
  meta?: SlotFile["meta"];
  diagnostics: Diagnostic[];
}

export async function checkSaves(root: string, schema: Schema): Promise<SaveFileReport[]> {
  const out: SaveFileReport[] = [];
  for (const x of await listJson(dirs(root).saves, SAVE_EXT)) {
    const v = x.parseError ? { ok: false, reason: "parse" } : verifySlot(x.raw);
    const r = parseSlot(schema, x.text);
    const f = x.raw as Partial<SlotFile> | undefined;
    out.push({ id: x.id, file: x.file, version: f?.version, slot: f?.slot, checksum: v.reason === "checksum" ? "bad" : v.ok ? "ok" : "n/a", ok: r.ok, reason: r.reason, message: r.message, migratedFrom: r.migratedFrom, meta: f?.meta, diagnostics: r.diagnostics });
  }
  return out;
}

// ------------------------------------------------------------------ strings

export const stringsPath = (root: string, id: string) => path.join(dirs(root).strings, `${assertSafeId(id, "table id")}${STRINGS_EXT}`);

export async function listStrings(root: string) {
  return (await listJson(dirs(root).strings, STRINGS_EXT)).map((x) => {
    const r = x.parseError ? { diagnostics: [{ path: `${x.id}${STRINGS_EXT}`, message: `JSON: ${x.parseError}`, severity: "error" as const }] } : checkStringsShape(x.raw, `${x.id}${STRINGS_EXT}`);
    return { id: x.id, file: x.file, doc: (r as { doc?: StringsDoc }).doc, diagnostics: r.diagnostics };
  });
}

export async function loadStrings(root: string): Promise<StringsDoc[]> {
  return (await listStrings(root)).filter((x) => x.doc).map((x) => x.doc!);
}

export async function writeStrings(root: string, doc: StringsDoc, opts: { dryRun?: boolean } = {}): Promise<{ ok: boolean; file: string; diagnostics: Diagnostic[] }> {
  const file = stringsPath(root, doc.id);
  const shape = checkStringsShape(doc, `${doc.id}${STRINGS_EXT}`);
  const others = (await loadStrings(root)).filter((d) => d.id !== doc.id);
  const content = shape.doc ? checkStrings([...others.map((d) => ({ file: `${d.id}${STRINGS_EXT}`, doc: d })), { file: `${doc.id}${STRINGS_EXT}`, doc }]) : { diagnostics: [] };
  const diagnostics = [...shape.diagnostics, ...content.diagnostics.filter((d) => d.path.startsWith(`${doc.id}${STRINGS_EXT}`) || d.message.includes(`${doc.id}${STRINGS_EXT}`))];
  const ok = !diagnostics.some((d) => d.severity === "error");
  if (ok && !opts.dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(sortedTable(doc), null, 2)}\n`);
  }
  return { ok, file, diagnostics };
}

async function walkFiles(p: string): Promise<string[]> {
  if (!existsSync(p)) return [];
  if (!(await stat(p)).isDirectory()) return [p];
  const out: string[] = [];
  for (const f of (await readdir(p)).sort()) out.push(...(await walkFiles(path.join(p, f))));
  return out;
}

export async function extractSources(root: string, extra: string[] = []): Promise<{ files: string[]; strings: Extracted[]; errors: Diagnostic[] }> {
  const cfg = await loadConfig(root);
  const files: string[] = [];
  for (const s of [...cfg.sources, ...extra]) for (const f of await walkFiles(resolveInside(root, s))) if (sourceKind(f) && !files.includes(f)) files.push(f);
  const strings: Extracted[] = [];
  const errors: Diagnostic[] = [];
  const seen = new Map<string, Extracted>();
  for (const f of files) {
    try {
      for (const e of extractFile(path.relative(root, f), await readFile(f, "utf8"))) {
        const prev = seen.get(e.key);
        if (prev && prev.text !== e.text) errors.push({ path: e.src, message: `key ${e.key} also extracted from ${prev.src} with different text`, severity: "warning" });
        if (!prev) {
          seen.set(e.key, e);
          strings.push(e);
        }
      }
    } catch (err) {
      errors.push({ path: path.relative(root, f), message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  }
  return { files: files.map((f) => path.relative(root, f)), strings, errors };
}

export interface ExtractReport {
  files: string[];
  tables: Record<string, MergeReport & { total: number }>;
  errors: Diagnostic[];
}

/** Extract every source into strings/<table>.easyi18n.json (dialogue, quests, ui, items), merging with what is there. */
export async function extractInto(root: string, opts: { extra?: string[]; prune?: boolean; dryRun?: boolean } = {}): Promise<ExtractReport> {
  const cfg = await loadConfig(root);
  const x = await extractSources(root, opts.extra);
  const existing = await loadStrings(root);
  const byTable = new Map<string, Extracted[]>();
  for (const e of x.strings) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);
  const report: ExtractReport = { files: x.files, tables: {}, errors: x.errors };
  for (const [table, found] of byTable) {
    const doc = structuredClone(existing.find((d) => d.id === table) ?? emptyTable(table, cfg.sourceLocale, cfg.locales));
    const r = mergeExtracted(doc, found, { prune: opts.prune });
    report.tables[table] = { ...r, total: Object.keys(doc.strings).length };
    if (!opts.dryRun) await writeFile(stringsPath(root, table), `${JSON.stringify(sortedTable(doc), null, 2)}\n`);
  }
  return report;
}

/** Keys the sources use that no table has, and table keys no source produces (tables fed by extraction only). */
export async function missingKeys(root: string): Promise<{ missing: Extracted[]; orphans: Array<{ table: string; key: string }> }> {
  const x = await extractSources(root);
  const docs = await loadStrings(root);
  const have = new Set(docs.flatMap((d) => Object.keys(d.strings)));
  const used = new Set(x.strings.map((e) => e.key));
  const extractedTables = new Set(x.strings.map((e) => e.table));
  return {
    missing: x.strings.filter((e) => !have.has(e.key)),
    orphans: docs.filter((d) => extractedTables.has(d.id)).flatMap((d) => Object.keys(d.strings).filter((k) => !used.has(k)).map((key) => ({ table: d.id, key }))),
  };
}

// ------------------------------------------------------------------ whole-workspace check

export interface WorkspaceCheck {
  ok: boolean;
  schemas: Array<{ id: string; version?: number; diagnostics: Diagnostic[] }>;
  saves: SaveFileReport[];
  strings: { tables: number; keys: number; coverage: Coverage[]; diagnostics: Diagnostic[] };
  extraction: { missing: number; orphans: number };
}

export async function checkWorkspace(root: string, opts: { strict?: boolean } = {}): Promise<WorkspaceCheck> {
  const schemas = await listSchemas(root);
  const out: WorkspaceCheck = { ok: true, schemas: schemas.map((s) => ({ id: s.id, version: s.schema?.version, diagnostics: s.diagnostics })), saves: [], strings: { tables: 0, keys: 0, coverage: [], diagnostics: [] }, extraction: { missing: 0, orphans: 0 } };
  const schema = schemas.find((s) => s.schema)?.schema;
  if (schema) {
    out.saves = await checkSaves(root, schema);
    // a default save must pass the schema it came from
    const n = normalize(schema, defaults(schema));
    if (n.diagnostics.some((d) => d.severity === "error")) out.schemas[0]!.diagnostics.push(...n.diagnostics.map((d) => ({ ...d, path: `defaults:${d.path}` })));
  }
  const tables = await listStrings(root);
  const docs = tables.filter((t) => t.doc).map((t) => ({ file: `${t.id}${STRINGS_EXT}`, doc: t.doc! }));
  const c = checkStrings(docs, opts);
  out.strings = { tables: tables.length, keys: docs.reduce((n, d) => n + Object.keys(d.doc.strings).length, 0), coverage: c.coverage, diagnostics: [...tables.flatMap((t) => t.diagnostics), ...c.diagnostics] };
  const mk = await missingKeys(root);
  out.extraction = { missing: mk.missing.length, orphans: mk.orphans.length };
  const errs = [...out.schemas.flatMap((s) => s.diagnostics), ...out.strings.diagnostics].filter((d) => d.severity === "error").length;
  out.ok = errs === 0 && schemas.length > 0 && out.saves.every((s) => s.ok) && (!opts.strict || mk.missing.length === 0);
  return out;
}

export { migrate };
