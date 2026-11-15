import { useCallback, useEffect, useMemo, useState } from "react";
import type { Diagnostic, Field, Locale, Schema, StringEntry, StringsDoc } from "../../src/core/types";
import { placeholders, thaiWrapHints } from "../../src/core/i18n";
import type { SlotInfo } from "../../src/core/store";
import * as api from "./api";
import type { WorkspaceCheck } from "./api";

type Tab = "schema" | "slots" | "strings";
const LOCALE_NAMES: Record<string, string> = { th: "ไทย", en: "English", ms: "Melayu" };
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function Diags({ list, max = 60 }: { list: Diagnostic[]; max?: number }) {
  const shown = list.filter((d) => d.severity !== "info");
  if (!shown.length) return <p className="hint">No problems.</p>;
  return (
    <div className="diag">
      {shown.slice(0, max).map((d, i) => (
        <p key={i} className={d.severity === "error" ? "err" : "warn"}>
          {d.severity === "error" ? "✖" : "▲"} <span className="mono">{d.path}</span> {d.message}
        </p>
      ))}
      {shown.length > max && <p className="hint">… {shown.length - max} more</p>}
    </div>
  );
}

function typeLabel(f: Field): string {
  if (f.type === "list" || f.type === "map") return `${f.type}<${f.of ? typeLabel(f.of) : "any"}>`;
  if (f.type === "enum") return `enum(${f.values?.join(" | ")})`;
  return f.type;
}

function FieldTree({ fields, depth = 0 }: { fields: Record<string, Field>; depth?: number }) {
  return (
    <>
      {Object.entries(fields).map(([k, f]) => {
        const nested = f.type === "object" ? f.fields : f.of?.type === "object" ? f.of.fields : undefined;
        return (
          <div key={k}>
            <div className="frow" style={{ paddingLeft: `${depth * 14}px` }}>
              <b className="mono">{k}</b>
              <span className="ftype">{typeLabel(f)}</span>
              {f.default !== undefined && f.type !== "object" && <span className="fdef mono">= {JSON.stringify(f.default)}</span>}
              {(f.min !== undefined || f.max !== undefined) && <span className="fdef">{f.min ?? "…"}..{f.max ?? "…"}</span>}
              {f.desc && <small>{f.desc}</small>}
            </div>
            {nested && <FieldTree fields={nested} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ Schema tab
function SchemaTab({ schema, defaults, onSaved, setStatus }: { schema: Schema; defaults: Record<string, unknown>; onSaved: () => void; setStatus: (s: string) => void }) {
  const [text, setText] = useState(pretty(schema));
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [fromV, setFromV] = useState(1);
  const [oldData, setOldData] = useState("");
  const [mig, setMig] = useState<api.MigrateResponse | null>(null);
  useEffect(() => setText(pretty(schema)), [schema]);

  const submit = async (dryRun: boolean) => {
    try {
      const r = await api.writeSchema(schema.id, JSON.parse(text), dryRun);
      setDiags(r.diagnostics);
      setStatus(r.ok ? (dryRun ? "Schema is valid" : "Schema saved") : "Schema has errors (not saved)");
      if (r.ok && !dryRun) onSaved();
    } catch (e) {
      setDiags([{ path: "JSON", message: String(e), severity: "error" }]);
    }
  };
  const runMigration = async () => {
    try {
      setMig(await api.migrateData(JSON.parse(oldData || "{}"), fromV));
    } catch (e) {
      setMig({ ok: false, error: String(e), steps: [] });
    }
  };

  return (
    <div className="layout schema">
      <section className="panel">
        <h3 className="sec">Fields · v{schema.version}</h3>
        <FieldTree fields={schema.fields} />
        <h3 className="sec">Slots</h3>
        <p className="hint">
          {schema.slots.manual} manual (slot_1…slot_{schema.slots.manual}){schema.slots.quick ? " · quick" : ""}
          {schema.slots.autosave ? ` · autosave every ${schema.slots.autosave.intervalSec}s, keep ${schema.slots.autosave.keep} (auto_0…)` : ""}
        </p>
        <h3 className="sec">Migrations</h3>
        {(schema.migrations ?? []).map((m) => (
          <div key={m.from} className="mig">
            <b>
              v{m.from} → v{m.to}
            </b>{" "}
            <small>{m.note}</small>
            <ul>
              {m.ops.map((o, i) => (
                <li key={i} className="mono">
                  {o.op} {o.from ?? o.path}
                  {o.to ? ` → ${o.to}` : ""}
                  {o.value !== undefined ? ` = ${JSON.stringify(o.value)}` : ""}
                  {o.values ? ` ${JSON.stringify(o.values)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="panel col">
        <h3 className="sec">Schema JSON</h3>
        <textarea className="code grow" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="toolbar">
          <button onClick={() => submit(true)}>Validate</button>
          <button className="primary" onClick={() => submit(false)}>
            Save schema
          </button>
          <span className="hint">Bump version and add a migration whenever saved data changes shape.</span>
        </div>
        <Diags list={diags} />
      </section>
      <section className="panel col">
        <h3 className="sec">Try a migration</h3>
        <div className="toolbar">
          <label>
            from v
            <input type="number" min={1} max={schema.version} value={fromV} onChange={(e) => setFromV(Number(e.target.value))} style={{ width: "4rem" }} />
          </label>
          <button onClick={runMigration}>Run</button>
        </div>
        <textarea className="code" rows={8} spellCheck={false} placeholder='old "data" object, e.g. from saves/slot_1.save.json' value={oldData} onChange={(e) => setOldData(e.target.value)} />
        {mig && (
          <>
            {mig.error && <p className="err">{mig.error}</p>}
            {mig.steps.map((s) => (
              <p key={s.from} className="hint">
                v{s.from} → v{s.to}: {s.changes.join(" · ")} changes
              </p>
            ))}
            {mig.diagnostics && <Diags list={mig.diagnostics} />}
            {mig.data && <pre className="json">{pretty(mig.data)}</pre>}
          </>
        )}
        <h3 className="sec">New save (defaults)</h3>
        <pre className="json">{pretty(defaults)}</pre>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Slots tab
function SlotsTab({ schema, defaults, setStatus }: { schema: Schema; defaults: Record<string, unknown>; setStatus: (s: string) => void }) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [sel, setSel] = useState<string>("slot_1");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.fetchSlot>> | null>(null);
  const [data, setData] = useState("");
  const [label, setLabel] = useState("");
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [paste, setPaste] = useState("");
  const [check, setCheck] = useState<Awaited<ReturnType<typeof api.validateSave>> | null>(null);

  const reload = useCallback(async (slot = sel) => {
    setSlots((await api.fetchSlots()).slots);
    const d = await api.fetchSlot(slot);
    setDetail(d);
    setData(pretty(d.result.ok ? d.result.data : defaults));
    setLabel(String(d.result.meta?.label ?? ""));
  }, [sel, defaults]);
  useEffect(() => void reload(sel), [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = async (slot: string) => {
    try {
      const r = await api.saveSlot(slot, JSON.parse(data), label || undefined);
      setDiags(r.diagnostics);
      setStatus(r.ok ? `Saved ${r.slot?.slot} · checksum ${r.slot?.checksum}` : `Not saved (${r.reason})`);
      await reload(slot === "auto" ? "auto_0" : slot);
      if (slot === "auto") setSel("auto_0");
    } catch (e) {
      setDiags([{ path: "JSON", message: String(e), severity: "error" }]);
    }
  };

  return (
    <div className="layout slots">
      <section className="panel">
        <h3 className="sec">Slots · {schema.id}</h3>
        {slots.map((s) => (
          <button key={s.slot} className={`slot-card ${sel === s.slot ? "on" : ""} ${!s.exists ? "empty" : s.ok ? "ok" : "bad"}`} onClick={() => setSel(s.slot)}>
            <span className="slot-id mono">{s.slot}</span>
            <span className="slot-body">
              <b>{s.exists ? String(s.meta?.label ?? "—") : "ว่าง · empty"}</b>
              <small>{s.exists ? (s.ok ? `v${s.version} · ${String(s.meta?.savedAt ?? "")}` : `✖ ${s.reason}`) : s.kind}</small>
            </span>
            {s.exists && s.version !== undefined && s.version < schema.version && <span className="badge gold">v{s.version}→v{schema.version}</span>}
            {s.hasBackup && <span className="badge">.bak</span>}
          </button>
        ))}
      </section>
      <section className="panel col">
        <h3 className="sec">
          {sel} {detail?.result.ok ? <span className="okc">loaded</span> : detail?.result.reason === "empty" ? <span className="hint">empty</span> : <span className="err">{detail?.result.reason}</span>}
          {detail?.result.migratedFrom ? <span className="badge gold">migrated from v{detail.result.migratedFrom}</span> : null}
          {detail?.result.usedBackup ? <span className="badge">from .bak</span> : null}
        </h3>
        {detail?.result.message && <p className="err">{detail.result.message}</p>}
        <div className="toolbar">
          <label>
            label <input className="search" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button className="primary" onClick={() => doSave(sel)}>
            Save to {sel}
          </button>
          <button onClick={() => doSave("auto")}>Autosave (rotate)</button>
          <button onClick={() => setData(pretty(defaults))}>Reset to defaults</button>
          <button
            onClick={async () => {
              await api.deleteSlot(sel);
              setStatus(`Deleted ${sel}`);
              await reload(sel);
            }}
          >
            Delete
          </button>
        </div>
        <textarea className="code grow" spellCheck={false} value={data} onChange={(e) => setData(e.target.value)} />
        <Diags list={[...diags, ...(detail?.result.diagnostics ?? [])]} max={20} />
      </section>
      <section className="panel col">
        <h3 className="sec">File on disk</h3>
        {detail?.file ? (
          <>
            <p className="hint mono">
              {detail.file.format} · {detail.file.game} v{detail.file.version} · checksum {detail.file.checksum}
            </p>
            <pre className="json">{pretty(detail.file.meta)}</pre>
          </>
        ) : (
          <p className="hint">No file.</p>
        )}
        <h3 className="sec">Check a save file</h3>
        <textarea className="code" rows={8} spellCheck={false} placeholder="paste a .save.json (from a player bug report…)" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button
          onClick={async () => {
            try {
              setCheck(await api.validateSave(JSON.parse(paste)));
            } catch (e) {
              setStatus(String(e));
            }
          }}
        >
          Check
        </button>
        {check && (
          <div>
            <p className={check.checksum.ok ? "okc" : "err"}>checksum {check.checksum.ok ? `ok (${check.checksum.actual})` : `${check.checksum.reason}${check.checksum.expected ? `: file ${check.checksum.expected}, computed ${check.checksum.actual}` : ""}`}</p>
            <p className={check.result.ok ? "okc" : "err"}>
              {check.result.ok ? `loads${check.result.migratedFrom ? ` (migrates from v${check.result.migratedFrom})` : ""}` : `fails: ${check.result.reason} ${check.result.message ?? ""}`}
            </p>
            <Diags list={check.result.diagnostics} max={10} />
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Strings tab
function StringCell({ table, k, entry, loc, onSaved }: { table: string; k: string; entry: StringEntry; loc: Locale; onSaved: (e: StringEntry, d: Diagnostic[]) => void }) {
  const [v, setV] = useState(entry[loc] ?? "");
  useEffect(() => setV(entry[loc] ?? ""), [entry, loc]);
  const stale = entry.stale?.includes(loc);
  const over = entry.max !== undefined && [...v].length > entry.max;
  if (entry.fixed && loc !== "th") return <td className="fixed">= th</td>;
  return (
    <td className={`${!v ? "missing" : ""} ${stale ? "stale" : ""} ${over ? "over" : ""}`}>
      <textarea
        rows={1}
        lang={loc}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if (v === (entry[loc] ?? "") && !stale) return;
          const r = await api.setString(table, k, loc, v);
          onSaved(r.entry ?? entry, r.diagnostics ?? []);
        }}
      />
    </td>
  );
}

function StringsTab({ locales, setStatus }: { locales: Locale[]; setStatus: (s: string) => void }) {
  const [res, setRes] = useState<api.StringsResponse | null>(null);
  const [table, setTable] = useState("save_ui");
  const [filter, setFilter] = useState("");
  const [missing, setMissing] = useState<"" | Locale>("");
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Locale>("th");
  const reload = useCallback(async () => setRes(await api.fetchStrings()), []);
  useEffect(() => void reload(), [reload]);
  const doc: StringsDoc | undefined = res?.tables.find((t) => t.id === table);
  const rows = useMemo(() => {
    if (!doc) return [];
    const q = filter.toLowerCase();
    return Object.entries(doc.strings).filter(([k, e]) => (!q || k.toLowerCase().includes(q) || Object.values(e).some((x) => typeof x === "string" && x.toLowerCase().includes(q))) && (!missing || (!e.fixed && (!e[missing] || e.stale?.includes(missing)))));
  }, [doc, filter, missing]);
  if (!res) return <p className="loading">Loading strings…</p>;
  const entry = sel && doc ? doc.strings[sel] : undefined;
  const sampleParams = { n: 3, money: 25, name: "ต้น", slot: 2, day: 2, item: "ข้าวเหนียวมะม่วง", count: 3, time: "19:40", label: "ตลาดเช้า" };

  return (
    <div className="layout strings">
      <section className="panel">
        <h3 className="sec">Tables</h3>
        {res.coverage.map((c) => (
          <button key={c.table} className={`item-btn ${table === c.table ? "on" : ""}`} onClick={() => setTable(c.table)}>
            <span className="grow">
              <b>{c.table}</b>
              <small>{c.total} keys</small>
              {Object.entries(c.locales).map(([l, v]) => (
                <span key={l} className="cov">
                  <i>{l}</i>
                  <span className="bar">
                    <span style={{ width: `${(100 * v.done) / Math.max(1, c.total)}%` }} />
                  </span>
                  <em>{Math.round((100 * v.done) / Math.max(1, c.total))}%</em>
                </span>
              ))}
            </span>
          </button>
        ))}
        <h3 className="sec">Sources</h3>
        <p className="hint">
          {res.sourceKeysMissing} keys used by sources but in no table · {res.orphans.length} orphans
        </p>
        <div className="toolbar">
          <button
            onClick={async () => {
              const r = await api.extract(false);
              setStatus(`Extracted from ${r.files.length} files: ${Object.entries(r.tables).map(([t, x]) => `${t} +${x.added.length}/${x.changed.length} stale`).join(", ")}`);
              await reload();
            }}
          >
            Extract strings
          </button>
        </div>
        <h3 className="sec">Translators</h3>
        <div className="toolbar">
          <a className="btn" href="/api/strings.csv">
            CSV
          </a>
          {locales
            .filter((l) => l !== "th")
            .map((l) => (
              <a key={l} className="btn" href={`/api/po/${l}`}>
                {l}.po
              </a>
            ))}
        </div>
        <h3 className="sec">Problems</h3>
        <Diags list={res.diagnostics.filter((d) => d.severity === "error" || !d.message.startsWith("missing"))} max={20} />
      </section>
      <section className="panel col">
        <div className="toolbar">
          <input className="search" placeholder="search key or text…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select value={missing} onChange={(e) => setMissing(e.target.value as Locale | "")}>
            <option value="">all</option>
            {locales
              .filter((l) => l !== "th")
              .map((l) => (
                <option key={l} value={l}>
                  missing / stale {l}
                </option>
              ))}
          </select>
          <span className="hint">{rows.length} rows</span>
        </div>
        <div className="tbl-wrap grow">
          <table className="strtbl">
            <thead>
              <tr>
                <th>key</th>
                {locales.map((l) => (
                  <th key={l}>
                    {l} · {LOCALE_NAMES[l]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(([k, e]) => (
                <tr key={k} className={sel === k ? "on" : ""} onClick={() => setSel(k)}>
                  <td className="key mono" title={e.src}>
                    {k}
                    {e.note && <small>{e.note}</small>}
                  </td>
                  {locales.map((l) => (
                    <StringCell
                      key={l}
                      table={table}
                      k={k}
                      entry={e}
                      loc={l}
                      onSaved={(ne, d) => {
                        setRes((r) => (r ? { ...r, tables: r.tables.map((t) => (t.id === table ? { ...t, strings: { ...t.strings, [k]: ne } } : t)) } : r));
                        setStatus(d.some((x) => x.severity === "error") ? `Not saved: ${d.find((x) => x.severity === "error")!.message}` : `Saved ${k} (${l})`);
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel col">
        <h3 className="sec">Preview</h3>
        <div className="tabs">
          {locales.map((l) => (
            <button key={l} className={preview === l ? "on" : ""} onClick={() => setPreview(l)}>
              {l}
            </button>
          ))}
        </div>
        {entry ? (
          <>
            <p className="mono hint">{sel}</p>
            <div className="dialog-box" lang={preview}>
              {((entry.fixed ? entry.th : entry[preview] || entry.en || entry.th) ?? "").replace(/\{(\w+)\}/g, (_, n: string) => String((sampleParams as Record<string, unknown>)[n] ?? `{${n}}`))}
            </div>
            <p className="hint">
              {entry[preview] || entry.fixed ? "" : `no ${preview} → falls back to ${entry.en ? "en" : "th"} · `}
              placeholders: {placeholders(entry.th ?? "").join(", ") || "none"}
              {entry.max !== undefined ? ` · max ${entry.max} chars` : ""}
              {entry.stale?.length ? ` · stale: ${entry.stale.join(", ")}` : ""}
            </p>
            {entry.src && <p className="hint">source: {entry.src}</p>}
            {preview === "th" && entry.th && (
              <p className="hint">
                Thai line breaks (ZWSP): <span className="mono">{thaiWrapHints(entry.th).replace(/\u200b/g, "·")}</span>
              </p>
            )}
          </>
        ) : (
          <p className="hint">Pick a row to preview it in a dialogue box with Kanit.</p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ App
export function App() {
  const [ws, setWs] = useState<api.WorkspaceInfo | null>(null);
  const [schema, setSchema] = useState<{ schema: Schema; defaults: Record<string, unknown> } | null>(null);
  const [check, setCheck] = useState<WorkspaceCheck | null>(null);
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get("tab") as Tab) || "slots");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [w, s, c] = await Promise.all([api.fetchWorkspace(), api.fetchSchema(), api.fetchCheck()]);
      setWs(w);
      setSchema(s);
      setCheck(c);
    } catch (e) {
      setErr(String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (err) return <p className="loading err">{err}</p>;
  if (!ws || !schema) return <p className="loading">Loading Easy Save…</p>;
  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <h1 className="brand">
              Easy <span>Save</span>
            </h1>
            <p className="brand-th">เซฟเกมและแปลภาษา ไทย · English · Melayu</p>
          </div>
        </div>
        <nav className="tabs">
          {(["schema", "slots", "strings"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "schema" ? "Schema" : t === "slots" ? "Slots" : "Strings"}
            </button>
          ))}
          <select
            value=""
            onChange={async (e) => {
              if (!e.target.value) return;
              const r = await api.exportSave(e.target.value);
              setStatus(`Exported ${r.files} files → ${r.dirs.join(", ")}`);
            }}
          >
            <option value="">Export…</option>
            {ws.presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </nav>
        <div className="status">
          {status || (check ? `${check.schemas.length} schema · ${check.saves.length} saves · ${check.strings.keys} strings · ${check.ok ? "check ok" : "check FAILED"}` : "")}
        </div>
      </header>
      {tab === "schema" && <SchemaTab schema={schema.schema} defaults={schema.defaults} onSaved={load} setStatus={setStatus} />}
      {tab === "slots" && <SlotsTab schema={schema.schema} defaults={schema.defaults} setStatus={setStatus} />}
      {tab === "strings" && <StringsTab locales={ws.config.locales} setStatus={setStatus} />}
    </>
  );
}
