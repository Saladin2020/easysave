import type { Locale, StringsDoc } from "../core/types.js";

const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
const unesc = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));

/**
 * gettext-style PO for one locale: msgctxt = key, msgid = source text, msgstr = translation. Translators can use
 * Poedit / Weblate; import maps entries back by msgctxt.
 */
export function toPo(docs: StringsDoc[], locale: Locale, source: Locale = "th"): string {
  const out = ['msgid ""', 'msgstr ""', `"Language: ${locale}\\n"`, '"MIME-Version: 1.0\\n"', '"Content-Type: text/plain; charset=UTF-8\\n"', '"Content-Transfer-Encoding: 8bit\\n"', `"X-Source-Language: ${source}\\n"`, '"X-Generator: Easy Save\\n"', ""];
  for (const d of docs) for (const k of Object.keys(d.strings).sort()) {
    const e = d.strings[k] as Record<string, unknown>;
    if (typeof e.note === "string") out.push(`#. ${e.note.replace(/\n/g, " ")}`);
    if (typeof e.src === "string") out.push(`#: ${e.src}`);
    if ((e.stale as string[] | undefined)?.includes(locale)) out.push("#, fuzzy");
    out.push(`msgctxt ${esc(k)}`, `msgid ${esc(String(e[source] ?? ""))}`, `msgstr ${esc(String(e[locale] ?? ""))}`, "");
  }
  return out.join("\n");
}

export interface PoEntry {
  ctx?: string;
  id: string;
  str: string;
  fuzzy: boolean;
}

export function parsePo(text: string): { locale?: string; entries: PoEntry[] } {
  const entries: PoEntry[] = [];
  let cur: Partial<PoEntry> & { fuzzy?: boolean } = {};
  let field: "ctx" | "id" | "str" | null = null;
  let locale: string | undefined;
  const flush = () => {
    if (cur.id !== undefined) {
      if (cur.id === "" && !cur.ctx) {
        const m = /Language:\s*([A-Za-z_-]+)/.exec(cur.str ?? "");
        if (m) locale = m[1];
      } else entries.push({ ctx: cur.ctx, id: cur.id, str: cur.str ?? "", fuzzy: !!cur.fuzzy });
    }
    cur = {};
    field = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("#,")) {
      if (cur.id !== undefined) flush();
      if (line.includes("fuzzy")) cur.fuzzy = true;
      continue;
    }
    if (line.startsWith("#")) {
      if (cur.id !== undefined) flush();
      continue;
    }
    const m = /^(msgctxt|msgid|msgstr)\s+"(.*)"$/.exec(line);
    if (m) {
      if (m[1] === "msgctxt" && cur.id !== undefined) flush();
      field = m[1] === "msgctxt" ? "ctx" : m[1] === "msgid" ? "id" : "str";
      cur[field] = unesc(m[2]!);
      continue;
    }
    const c = /^"(.*)"$/.exec(line);
    if (c && field) cur[field] = (cur[field] ?? "") + unesc(c[1]!);
  }
  flush();
  return { locale, entries };
}

export interface PoImportReport {
  locale: string;
  updated: number;
  unchanged: number;
  unknown: string[];
  sourceChanged: string[];
}

export function importPo(text: string, docs: StringsDoc[], localeHint?: Locale): PoImportReport {
  const { locale: fileLoc, entries } = parsePo(text);
  const locale = (localeHint ?? fileLoc) as Locale | undefined;
  if (!locale) throw new Error("PO file has no Language header; pass the locale");
  const r: PoImportReport = { locale, updated: 0, unchanged: 0, unknown: [], sourceChanged: [] };
  for (const e of entries) {
    const key = e.ctx ?? "";
    const doc = docs.find((d) => key in d.strings);
    if (!doc) {
      r.unknown.push(key || e.id);
      continue;
    }
    if (!doc.locales.includes(locale)) continue;
    const s = doc.strings[key] as Record<string, unknown>;
    if (String(s[doc.source] ?? "") !== e.id) r.sourceChanged.push(key);
    if (!e.str || s[locale] === e.str) {
      r.unchanged++;
      continue;
    }
    s[locale] = e.str;
    const stale = new Set((s.stale as string[] | undefined) ?? []);
    if (e.fuzzy || r.sourceChanged.includes(key)) stale.add(locale);
    else stale.delete(locale);
    if (stale.size) s.stale = [...stale].sort();
    else delete s.stale;
    r.updated++;
  }
  return r;
}
