#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { canon } from "./core/canon.js";
import { defaults, migrate, normalize } from "./core/schema.js";
import { readSlot, verifySlot } from "./core/slot.js";
import { LOCALES, type Diagnostic, type Field, type Locale, type SlotFile, type StringsDoc } from "./core/types.js";
import { importCsv, toCsv } from "./shared/csv.js";
import { fontNotesText } from "./shared/fonts.js";
import { importPo, toPo } from "./shared/po.js";
import { checkStrings } from "./shared/strings.js";
import { EXPORT_PRESETS, exportSave, type ExportPreset } from "./lib/export.js";
import { STRINGS_EXT, checkWorkspace, dirs, extractInto, initWorkspace, listSchemas, loadConfig, loadSchema, loadStrings, missingKeys, resolveWorkspace, saveStore, writeStrings } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYSAVE_WORKSPACE?.trim() || process.env.EASYSAVE_HOME?.trim() || process.cwd();
  return resolveWorkspace(v);
}

const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};
const collect = (v: string, prev: string[]) => [...prev, v];
const printDiags = (list: Diagnostic[], max = 40) => {
  const shown = list.filter((d) => d.severity !== "info");
  for (const d of shown.slice(0, max)) console.log(`  ${d.severity === "error" ? "error" : "warn "} ${d.path}: ${d.message}`);
  if (shown.length > max) console.log(`  … ${shown.length - max} more`);
};

program.name("easysave").description("Save slots (schema, migrations, checksum, autosave) and Thai / English / Malay string tables → Godot SaveManager + TranslationServer, web localStorage + i18n").version("0.1.0");

program
  .command("init")
  .description("Create schemas/ saves/ strings/ sources/ exports/ with the village delivery sample")
  .option("--force", "Overwrite samples and config")
  .option("--workspace <path>")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    const docs = await loadStrings(root);
    console.log(`Initialized Easy Save workspace at ${root}`);
    console.log("  schemas/  *.easysave.json — village_delivery v3 (migrations from v1)");
    console.log("  saves/    *.save.json — slot_1 (an old v1 save), slot_2, auto_0");
    console.log(`  strings/  *.easyi18n.json — ${docs.map((d) => d.id).join(", ")} (${docs.reduce((n, d) => n + Object.keys(d.strings).length, 0)} keys)`);
    console.log("  sources/  Easy Dialogue / Quest / UI / Items files read by `easysave extract`");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const root = workspaceOf(o.workspace);
    const r = await checkWorkspace(root);
    if (o.json) return console.log(JSON.stringify(r, null, 2));
    console.log(`Easy Save workspace ${root}`);
    for (const s of r.schemas) console.log(`  schema ${s.id} v${s.version ?? "?"}${s.diagnostics.some((d) => d.severity === "error") ? " (ERRORS)" : ""}`);
    console.log(`  saves: ${r.saves.map((s) => `${s.id}${s.ok ? "" : ` (${s.reason})`}${s.migratedFrom ? ` (v${s.migratedFrom}→v${r.schemas[0]?.version})` : ""}`).join(", ") || "(none)"}`);
    console.log(`  strings: ${r.strings.tables} tables · ${r.strings.keys} keys`);
    for (const c of r.strings.coverage) console.log(`    ${c.table.padEnd(10)} ${String(c.total).padStart(4)} keys · ${Object.entries(c.locales).map(([l, v]) => `${l} ${Math.round((100 * v.done) / Math.max(1, c.total))}%`).join(" · ")}`);
  });

function fieldLines(fields: Record<string, Field>, indent = "  "): string[] {
  const out: string[] = [];
  for (const [k, f] of Object.entries(fields)) {
    const t = f.type === "list" || f.type === "map" ? `${f.type}<${f.of?.type}>` : f.type === "enum" ? `enum(${f.values?.join("|")})` : f.type;
    const extra = [f.default !== undefined && f.type !== "object" ? `= ${canon(f.default)}` : "", f.min !== undefined ? `min ${f.min}` : "", f.max !== undefined ? `max ${f.max}` : "", f.desc ? `· ${f.desc}` : ""].filter(Boolean).join(" ");
    out.push(`${indent}${k}: ${t} ${extra}`.trimEnd());
    if (f.type === "object" && f.fields) out.push(...fieldLines(f.fields, `${indent}  `));
    if (f.of?.type === "object" && f.of.fields) out.push(...fieldLines(f.of.fields, `${indent}  `));
  }
  return out;
}

program
  .command("schema")
  .description("Show the save schema: fields, slots and migrations")
  .argument("[id]")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string | undefined, o: { workspace?: string; json?: boolean }) => {
    try {
      const s = await loadSchema(workspaceOf(o.workspace), id);
      if (o.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`${s.id} v${s.version} · ${s.name?.th ?? ""}${s.name?.en ? ` · ${s.name.en}` : ""}`);
      console.log(`slots: ${s.slots.manual} manual${s.slots.quick ? " + quick" : ""}${s.slots.autosave ? ` + autosave every ${s.slots.autosave.intervalSec}s (keep ${s.slots.autosave.keep})` : ""}`);
      console.log("fields:");
      for (const l of fieldLines(s.fields)) console.log(l);
      for (const m of s.migrations ?? []) console.log(`migration v${m.from}→v${m.to}: ${m.ops.map((x) => `${x.op} ${x.from ?? x.path}${x.to ? `→${x.to}` : ""}`).join(", ")}${m.note ? `  (${m.note})` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("defaults")
  .description("A fresh save's data (schema defaults) as JSON")
  .option("--out <file>")
  .option("--workspace <path>")
  .action(async (o: { out?: string; workspace?: string }) => {
    try {
      const d = defaults(await loadSchema(workspaceOf(o.workspace)));
      const text = `${JSON.stringify(d, null, 2)}\n`;
      if (o.out) await writeFile(path.resolve(o.out), text);
      else process.stdout.write(text);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description("Check schemas, saves (checksum, migration, fields) and string tables. Exit code 1 on errors")
  .option("--strict", "Missing translations and keys the sources use but no table has are errors")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { strict?: boolean; workspace?: string; json?: boolean }) => {
    const r = await checkWorkspace(workspaceOf(o.workspace), { strict: o.strict });
    if (o.json) {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 1);
    }
    for (const s of r.schemas) {
      console.log(`schema ${s.id} v${s.version ?? "?"}`);
      printDiags(s.diagnostics);
    }
    for (const s of r.saves) {
      console.log(`${s.ok ? "ok  " : "FAIL"} save ${s.id} (${s.slot ?? "?"}, v${s.version ?? "?"}, checksum ${s.checksum})${s.migratedFrom ? ` migrates v${s.migratedFrom}→v${r.schemas[0]?.version}` : ""}${s.ok ? "" : ` · ${s.reason}${s.message ? `: ${s.message}` : ""}`}`);
      printDiags(s.diagnostics, 8);
    }
    const errs = r.strings.diagnostics.filter((d) => d.severity === "error");
    const warns = r.strings.diagnostics.filter((d) => d.severity === "warning");
    console.log(`strings: ${r.strings.tables} tables · ${r.strings.keys} keys · ${errs.length} errors · ${warns.length} warnings`);
    for (const c of r.strings.coverage) console.log(`  ${c.table.padEnd(10)} ${String(c.total).padStart(4)} keys · ${Object.entries(c.locales).map(([l, v]) => `${l} ${v.done}/${c.total}${v.stale ? ` (${v.stale} stale)` : ""}`).join(" · ")}`);
    printDiags(errs, 30);
    if (o.strict) printDiags(warns, 30);
    else if (warns.length) console.log(`  (${warns.length} warnings: missing translations etc. — see \`easysave strings --missing\`)`);
    console.log(`sources: ${r.extraction.missing} keys not in any table · ${r.extraction.orphans} table keys no source uses${r.extraction.missing ? " (run easysave extract)" : ""}`);
    console.log(r.ok ? "ok" : "FAIL");
    process.exit(r.ok ? 0 : 1);
  });

program
  .command("verify")
  .description("Verify one save file: checksum, game, version, fields (after migration)")
  .argument("<file>")
  .option("--workspace <path>")
  .action(async (file: string, o: { workspace?: string }) => {
    try {
      const schema = await loadSchema(workspaceOf(o.workspace));
      const raw = JSON.parse(await readFile(path.resolve(file), "utf8")) as SlotFile;
      const v = verifySlot(raw);
      console.log(`checksum: ${v.ok ? `ok (${v.actual})` : v.reason === "checksum" ? `MISMATCH file ${v.expected} · computed ${v.actual}` : v.reason}`);
      const r = readSlot(schema, raw);
      console.log(r.ok ? `ok · ${raw.game} v${raw.version}${r.migratedFrom ? ` (migrates to v${schema.version})` : ""} · ${raw.meta?.label ?? ""}` : `FAIL ${r.reason}${r.message ? `: ${r.message}` : ""}`);
      printDiags(r.diagnostics);
      process.exit(r.ok ? 0 : 1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("migrate")
  .description("Migrate a save file to the schema version (prints the result; --out writes a new slot file)")
  .argument("<file>")
  .option("--out <file>", "Write the migrated save (new checksum)")
  .option("--workspace <path>")
  .action(async (file: string, o: { out?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const schema = await loadSchema(root);
      const raw = JSON.parse(await readFile(path.resolve(file), "utf8")) as SlotFile;
      const v = verifySlot(raw);
      if (!v.ok) throw new Error(`${file}: ${v.reason}${v.reason === "checksum" ? ` (file ${v.expected}, computed ${v.actual})` : ""}`);
      const m = migrate(schema, raw.data, raw.version);
      if (!m.ok) throw new Error(m.error);
      for (const s of m.steps) {
        const mig = schema.migrations!.find((x) => x.from === s.from)!;
        console.log(`v${s.from} → v${s.to}: ${mig.ops.map((op, i) => `${op.op} ${op.from ?? op.path}${op.to ? `→${op.to}` : ""} (${s.changes[i]})`).join(", ")}`);
      }
      const n = normalize(schema, m.data);
      printDiags(n.diagnostics);
      if (n.diagnostics.some((d) => d.severity === "error")) throw new Error("migrated data does not match the schema");
      if (o.out) {
        const store = await saveStore(root);
        const { makeSlot } = await import("./core/slot.js");
        const f = makeSlot(store.schema, raw.slot, n.data, { ...raw.meta });
        await writeFile(path.resolve(o.out), `${JSON.stringify(f, null, 2)}\n`);
        console.log(`wrote ${o.out} (v${f.version}, checksum ${f.checksum})`);
      } else console.log(JSON.stringify(n.data, null, 2));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("save")
  .description("Write a slot in saves/ from a data file (default: schema defaults); keeps the previous file as .bak")
  .argument("<slot>", "slot_1 … | quick | auto (rotates auto_0 → auto_1 …)")
  .option("--data <file>", "JSON data (validated and normalised)")
  .option("--label <text>")
  .option("--workspace <path>")
  .action(async (slot: string, o: { data?: string; label?: string; workspace?: string }) => {
    try {
      const store = await saveStore(workspaceOf(o.workspace));
      const data = o.data ? JSON.parse(await readFile(path.resolve(o.data), "utf8")) : defaults(store.schema);
      const r = slot === "auto" ? store.autosave(data, { label: o.label }) : store.save(slot, data, { ...(o.label ? { label: o.label } : {}) });
      printDiags(r.diagnostics);
      if (!r.ok) throw new Error(`not saved (${r.reason})`);
      console.log(`saved ${r.slot!.slot} · v${r.slot!.version} · checksum ${r.slot!.checksum}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("slots")
  .description("Slots in saves/ with status (ok / checksum / migrates)")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    try {
      const store = await saveStore(workspaceOf(o.workspace));
      const list = store.list();
      if (o.json) return console.log(JSON.stringify(list, null, 2));
      for (const s of list) console.log(`${s.slot.padEnd(8)} ${!s.exists ? "empty" : s.ok ? `ok v${s.version} · ${s.meta?.savedAt ?? ""} · ${s.meta?.label ?? ""}` : `BAD (${s.reason})`}${s.hasBackup ? " · .bak" : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("extract")
  .description("Extract strings from sources (.ezd, .dialogue.json, .ezq, .easyui.json, .easyitems.json) into strings/")
  .option("--from <path>", "Extra file or folder (repeatable; config `sources` is always read)", collect, [])
  .option("--prune", "Remove keys no source produces any more")
  .option("--dry-run", "Report only")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { from: string[]; prune?: boolean; dryRun?: boolean; workspace?: string; json?: boolean }) => {
    try {
      const r = await extractInto(workspaceOf(o.workspace), { extra: o.from, prune: o.prune, dryRun: o.dryRun });
      if (o.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`${r.files.length} source files`);
      for (const [t, x] of Object.entries(r.tables)) console.log(`  ${t.padEnd(10)} ${x.total} keys · +${x.added.length} new · ${x.changed.length} changed (stale) · ${x.filled.length} filled · ${x.orphans.length} orphans${o.prune && x.orphans.length ? " (pruned)" : ""}`);
      printDiags(r.errors);
      if (o.dryRun) console.log("(dry run: nothing written)");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("strings")
  .description("Coverage per table and locale; --missing lists untranslated keys")
  .option("--missing", "List missing translations")
  .option("--locale <l>", LOCALES.join(" | "))
  .option("--table <id>")
  .option("--keys", "Also list keys used by sources but in no table")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { missing?: boolean; locale?: string; table?: string; keys?: boolean; workspace?: string; json?: boolean }) => {
    const root = workspaceOf(o.workspace);
    const docs = (await loadStrings(root)).filter((d) => !o.table || d.id === o.table);
    const c = checkStrings(docs.map((d) => ({ file: `${d.id}${STRINGS_EXT}`, doc: d })));
    const missing = c.missing.filter((m) => (!o.locale || m.locale === o.locale) && m.locale !== "th");
    const mk = o.keys ? await missingKeys(root) : undefined;
    if (o.json) return console.log(JSON.stringify({ coverage: c.coverage, missing, sourceKeysMissing: mk?.missing.map((m) => m.key), orphans: mk?.orphans }, null, 2));
    for (const cov of c.coverage) console.log(`${cov.table.padEnd(10)} ${String(cov.total).padStart(4)} keys · ${Object.entries(cov.locales).map(([l, v]) => `${l} ${Math.round((100 * v.done) / Math.max(1, cov.total))}%`).join(" · ")}`);
    if (o.missing) {
      for (const m of missing.slice(0, 200)) {
        const d = docs.find((x) => x.id === m.table)!;
        console.log(`  ${m.locale} ${m.key}  ${String((d.strings[m.key] as Record<string, unknown>)[d.source] ?? "")}`);
      }
      if (missing.length > 200) console.log(`  … ${missing.length - 200} more`);
    }
    if (mk) {
      console.log(`keys used by sources but in no table: ${mk.missing.length}`);
      for (const m of mk.missing.slice(0, 50)) console.log(`  ${m.key}  (${m.src})`);
      console.log(`table keys no source uses: ${mk.orphans.length}`);
    }
  });

program
  .command("strings-export")
  .description("Export string tables for translators: csv (keys,th,en,ms) or po (one file per locale)")
  .option("--format <f>", "csv | po", "csv")
  .option("--locale <l>", "po: only this locale")
  .option("--table <id>", "Only this table")
  .option("--out <path>", "File (csv) or folder (po); default exports/strings/")
  .option("--workspace <path>")
  .action(async (o: { format: string; locale?: string; table?: string; out?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const cfg = await loadConfig(root);
      const docs = (await loadStrings(root)).filter((d) => !o.table || d.id === o.table);
      const outDir = path.join(dirs(root).exports, "strings");
      if (o.format === "csv") {
        const f = path.resolve(o.out ?? path.join(outDir, `${o.table ?? "strings"}.csv`));
        await mkdir(path.dirname(f), { recursive: true });
        await writeFile(f, toCsv(docs, cfg.locales));
        console.log(`wrote ${f}`);
      } else if (o.format === "po") {
        const dir = path.resolve(o.out ?? outDir);
        await mkdir(dir, { recursive: true });
        for (const l of cfg.locales.filter((x) => x !== cfg.sourceLocale && (!o.locale || x === o.locale))) {
          const f = path.join(dir, `${o.table ?? "strings"}.${l}.po`);
          await writeFile(f, toPo(docs, l, cfg.sourceLocale));
          console.log(`wrote ${f}`);
        }
      } else throw new Error("--format csv | po");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("strings-import")
  .description("Import translations from a .csv (keys,th,en,ms) or .po file into the tables that own the keys")
  .argument("<file>")
  .option("--locale <l>", "po: locale when the file has no Language header")
  .option("--dry-run")
  .option("--workspace <path>")
  .action(async (file: string, o: { locale?: string; dryRun?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const docs = await loadStrings(root);
      const before = JSON.stringify(docs);
      const text = await readFile(path.resolve(file), "utf8");
      if (file.endsWith(".po")) {
        const r = importPo(text, docs, o.locale as Locale | undefined);
        console.log(`${r.locale}: ${r.updated} updated · ${r.unchanged} unchanged · ${r.unknown.length} unknown keys${r.sourceChanged.length ? ` · ${r.sourceChanged.length} source text changed since export (marked stale)` : ""}`);
      } else {
        const r = importCsv(text, docs);
        console.log(`${r.locales.join(",")}: ${r.updated} updated · ${r.unchanged} unchanged · ${r.unknown.length} unknown keys${r.unknown.length ? ` (${r.unknown.slice(0, 5).join(", ")}…)` : ""}`);
      }
      if (o.dryRun || JSON.stringify(docs) === before) return;
      for (const d of docs) {
        const w = await writeStrings(root, d);
        if (!w.ok) {
          printDiags(w.diagnostics.filter((x) => x.severity === "error"));
          throw new Error(`${d.id}: not written (errors above)`);
        }
      }
      console.log("tables written");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("fonts")
  .description("Thai font and line-breaking notes")
  .option("--workspace <path>", "(ignored; accepted like every other command)")
  .action(() => console.log(fontNotesText()));

program
  .command("export")
  .description(`Export: ${EXPORT_PRESETS.join(" | ")}`)
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (single preset; default exports/easysave-<preset>)")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { preset: string; out?: string; workspace?: string; json?: boolean }) => {
    try {
      const r = await exportSave(workspaceOf(o.workspace), { preset: o.preset as ExportPreset, out: o.out, trustedPaths: true });
      if (o.json) return console.log(JSON.stringify({ ...r, files: r.files.length }, null, 2));
      for (const d of r.dirs) console.log(`exported ${d}`);
      console.log(`  ${r.keys} string keys · ${r.saves} sample saves · ${r.files.length} files`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8898)")
  .option("--port <port>", "Port", "8898")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5186")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!(await listSchemas(root)).length && !existsSync(dirs(root).strings)) await initWorkspace(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy Save ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) console.log("Run the UI with: npx vite --config web/vite.config.ts");
      if (o.open) void open(o.dev ? "http://127.0.0.1:5186" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);

export type { StringsDoc };
