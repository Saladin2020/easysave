import type { Locale, StringsDoc } from "../core/types.js";

const q = (s: string) => (/[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Godot translation CSV: `keys,th,en,ms` (import in Godot → one .translation per locale). */
export function toCsv(docs: StringsDoc[], locales: readonly Locale[]): string {
  const rows = [["keys", ...locales].join(",")];
  for (const d of docs) for (const k of Object.keys(d.strings).sort()) {
    const e = d.strings[k] as Record<string, unknown>;
    rows.push([k, ...locales.map((l) => (typeof e[l] === "string" ? (e[l] as string) : ""))].map(q).join(","));
  }
  return `${rows.join("\n")}\n`;
}

/** RFC 4180 parser (quotes, doubled quotes, newlines inside quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

export interface ImportReport {
  updated: number;
  unchanged: number;
  unknown: string[];
  locales: string[];
}

/** Apply CSV translations to the tables that own each key. Empty cells never erase a translation. */
export function importCsv(text: string, docs: StringsDoc[], opts: { addUnknownTo?: StringsDoc } = {}): ImportReport {
  const rows = parseCsv(text);
  const head = rows.shift() ?? [];
  if (!/^(keys?|id)$/i.test(head[0] ?? "")) throw new Error('CSV must start with a "keys" column');
  const locs = head.slice(1).map((h) => h.trim());
  const r: ImportReport = { updated: 0, unchanged: 0, unknown: [], locales: locs };
  for (const row of rows) {
    const key = row[0]!.trim();
    let doc = docs.find((d) => key in d.strings);
    if (!doc && opts.addUnknownTo) {
      doc = opts.addUnknownTo;
      doc.strings[key] = {};
    }
    if (!doc) {
      r.unknown.push(key);
      continue;
    }
    const e = doc.strings[key] as Record<string, unknown>;
    let changed = false;
    locs.forEach((l, i) => {
      const v = row[i + 1] ?? "";
      if (!doc!.locales.includes(l as Locale) || v === "" || e[l] === v) return;
      e[l] = v;
      changed = true;
      const st = (e.stale as string[] | undefined)?.filter((x) => x !== l);
      if (st) {
        if (st.length) e.stale = st;
        else delete e.stale;
      }
    });
    if (changed) r.updated++;
    else r.unchanged++;
  }
  return r;
}
