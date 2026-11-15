import { Diags } from "../core/schema.js";
import { hasThai, placeholders } from "../core/i18n.js";
import { LOCALES, STRINGS_FORMAT, type Diagnostic, type Locale, type StringEntry, type StringsDoc } from "../core/types.js";

export const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkStringsShape(raw: unknown, file = ""): { doc?: StringsDoc; diagnostics: Diagnostic[] } {
  const d = new Diags();
  const at = (p: string) => (file ? `${file}:${p}` : p);
  if (!isObj(raw)) return { diagnostics: [{ path: at(""), message: "string table must be an object", severity: "error" }] };
  if (raw.format !== STRINGS_FORMAT) d.err(at("format"), `must be "${STRINGS_FORMAT}"`);
  if (typeof raw.id !== "string" || !/^[a-z0-9_-]+$/.test(raw.id)) d.err(at("id"), "id: a-z, 0-9, _ or -");
  if (!LOCALES.includes(raw.source as Locale)) d.err(at("source"), LOCALES.join(" | "));
  if (!Array.isArray(raw.locales) || raw.locales.some((l) => !LOCALES.includes(l as Locale))) d.err(at("locales"), `subset of ${LOCALES.join(", ")}`);
  if (!isObj(raw.strings)) d.err(at("strings"), "object { key: { th, en, ms, note? } }");
  else for (const [k, e] of Object.entries(raw.strings)) {
    if (!KEY_RE.test(k)) d.err(at(`strings.${k}`), "keys: letters, digits, _ . -");
    if (!isObj(e)) d.err(at(`strings.${k}`), "object { th, en, ms }");
    else for (const [f, v] of Object.entries(e)) {
      if (f === "stale") {
        if (!Array.isArray(v)) d.err(at(`strings.${k}.stale`), "array of locales");
      } else if (f === "fixed") {
        if (typeof v !== "boolean") d.err(at(`strings.${k}.fixed`), "true or false");
      } else if (f === "max") {
        if (typeof v !== "number") d.err(at(`strings.${k}.max`), "number");
      } else if (typeof v !== "string") d.err(at(`strings.${k}.${f}`), "text");
    }
  }
  return { doc: d.errors.length ? undefined : (raw as unknown as StringsDoc), diagnostics: d.list };
}

export interface Coverage {
  table: string;
  total: number;
  locales: Record<string, { done: number; missing: number; stale: number }>;
}

/** Content checks across tables: duplicates, missing translations, placeholders, Thai in en / ms, length, stale. */
export function checkStrings(docs: Array<{ file: string; doc: StringsDoc }>, opts: { strict?: boolean } = {}): { diagnostics: Diagnostic[]; coverage: Coverage[]; missing: Array<{ table: string; key: string; locale: string }> } {
  const d = new Diags();
  const seen = new Map<string, string>();
  const coverage: Coverage[] = [];
  const missing: Array<{ table: string; key: string; locale: string }> = [];
  for (const { file, doc } of docs) {
    const cov: Coverage = { table: doc.id, total: 0, locales: Object.fromEntries(doc.locales.map((l) => [l, { done: 0, missing: 0, stale: 0 }])) };
    for (const [key, e] of Object.entries(doc.strings)) {
      const p = `${file}:strings.${key}`;
      cov.total++;
      if (seen.has(key)) d.err(p, `duplicate key (also in ${seen.get(key)})`);
      else seen.set(key, file);
      const src = (e as Record<string, unknown>)[doc.source] as string | undefined;
      if (!src) d.err(p, `no ${doc.source} source text`);
      const srcPh = src ? placeholders(src).join(",") : "";
      if (e.fixed) {
        for (const loc of doc.locales) cov.locales[loc]!.done++;
        continue;
      }
      for (const loc of doc.locales) {
        const v = (e as Record<string, unknown>)[loc] as string | undefined;
        const c = cov.locales[loc]!;
        if (!v) {
          c.missing++;
          missing.push({ table: doc.id, key, locale: loc });
          if (loc !== doc.source) (opts.strict ? d.err : d.warn).call(d, `${p}.${loc}`, `missing ${loc}`);
          continue;
        }
        c.done++;
        if (e.stale?.includes(loc)) {
          c.stale++;
          d.warn(`${p}.${loc}`, `stale: the ${doc.source} text changed after this was translated`);
        }
        if (loc === doc.source) continue;
        if (placeholders(v).join(",") !== srcPh) d.err(`${p}.${loc}`, `placeholders {${placeholders(v).join("} {")}} differ from the source {${srcPh.split(",").filter(Boolean).join("} {")}}`);
        if (loc !== "th" && hasThai(v)) d.warn(`${p}.${loc}`, "contains Thai script");
        if (src && /^\s|\s$/.test(src) !== /^\s|\s$/.test(v)) d.warn(`${p}.${loc}`, "leading / trailing spaces differ from the source");
        if (e.max !== undefined && [...v].length > e.max) d.warn(`${p}.${loc}`, `longer than max ${e.max}`);
      }
    }
    coverage.push(cov);
  }
  return { diagnostics: d.list, coverage, missing };
}

export interface Extracted {
  key: string;
  text: string;
  /** Translations already present in the source (Easy Items names). */
  en?: string;
  ms?: string;
  src: string;
  note?: string;
  table: string;
}

export interface MergeReport {
  added: string[];
  changed: string[];
  filled: string[];
  orphans: string[];
}

/**
 * Merge extracted strings into a table: new keys are added; a changed source text replaces the old one and marks
 * existing translations stale; translations shipped with the source fill empty locales. Keys no longer extracted
 * are reported as orphans (and removed with prune).
 */
export function mergeExtracted(doc: StringsDoc, found: Extracted[], opts: { prune?: boolean } = {}): MergeReport {
  const r: MergeReport = { added: [], changed: [], filled: [], orphans: [] };
  const keys = new Set(found.map((f) => f.key));
  for (const f of found) {
    const e = doc.strings[f.key];
    if (!e) {
      const ne: StringEntry = { [doc.source]: f.text } as StringEntry;
      if (f.en && doc.locales.includes("en") && doc.source !== "en") ne.en = f.en;
      if (f.ms && doc.locales.includes("ms") && doc.source !== "ms") ne.ms = f.ms;
      if (f.note) ne.note = f.note;
      ne.src = f.src;
      doc.strings[f.key] = ne;
      r.added.push(f.key);
      continue;
    }
    const cur = (e as Record<string, unknown>)[doc.source];
    if (cur !== f.text) {
      (e as Record<string, unknown>)[doc.source] = f.text;
      const stale = doc.locales.filter((l) => l !== doc.source && (e as Record<string, unknown>)[l]);
      if (stale.length) e.stale = [...new Set([...(e.stale ?? []), ...stale])].sort();
      r.changed.push(f.key);
    }
    for (const loc of ["en", "ms"] as const) {
      if (f[loc] && !e[loc] && doc.locales.includes(loc)) {
        e[loc] = f[loc];
        r.filled.push(`${f.key}.${loc}`);
      }
    }
    e.src = f.src;
  }
  for (const k of Object.keys(doc.strings)) {
    if (keys.has(k)) continue;
    r.orphans.push(k);
    if (opts.prune) delete doc.strings[k];
  }
  return r;
}

export function emptyTable(id: string, source: Locale = "th", locales: Locale[] = [...LOCALES]): StringsDoc {
  return { format: STRINGS_FORMAT, id, source, locales, strings: {} };
}

/** Sort keys for stable files. */
export function sortedTable(doc: StringsDoc): StringsDoc {
  const strings: Record<string, StringEntry> = {};
  for (const k of Object.keys(doc.strings).sort()) {
    const e = doc.strings[k]!;
    const o: Record<string, unknown> = {};
    for (const f of [...doc.locales, "note", "src", "stale", "max", "fixed"]) if ((e as Record<string, unknown>)[f] !== undefined) o[f] = (e as Record<string, unknown>)[f];
    for (const [f, v] of Object.entries(e)) if (!(f in o)) o[f] = v;
    strings[k] = o as StringEntry;
  }
  return { ...doc, strings };
}
