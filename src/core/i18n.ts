import type { StringEntry, StringsDoc } from "./types.js";

export type Table = Record<string, StringEntry>;

/** Merge string tables into one key → entry map (later tables win on duplicate keys). */
export function mergeTables(docs: Array<StringsDoc | { strings: Table }>): Table {
  const out: Table = {};
  for (const d of docs) Object.assign(out, d.strings);
  return out;
}

const PH = /\{([a-zA-Z0-9_]+)\}/g;

export function placeholders(s: string): string[] {
  return [...s.matchAll(PH)].map((m) => m[1]!).sort();
}

export function format(s: string, params: Record<string, unknown> = {}): string {
  return s.replace(PH, (all, k: string) => (k in params ? String(params[k]) : all));
}

/**
 * Runtime lookup with a fallback chain: the current locale, then `fallback` locales (default en, th), then the key
 * itself (so a missing key is visible on screen). `{name}` placeholders are filled from params, like Godot's
 * String.format.
 */
export class I18n {
  locale: string;
  fallback: string[];
  private table: Table;
  missing = new Set<string>();

  constructor(tables: Array<StringsDoc | { strings: Table }> | Table, opts: { locale?: string; fallback?: string[] } = {}) {
    this.table = Array.isArray(tables) ? mergeTables(tables) : tables;
    this.locale = opts.locale ?? "th";
    this.fallback = opts.fallback ?? ["en", "th"];
  }

  setLocale(locale: string) {
    this.locale = locale;
  }

  has(key: string, locale = this.locale) {
    const e = this.table[key];
    return !!e && typeof (e as Record<string, unknown>)[locale] === "string" && (e as Record<string, string>)[locale] !== "";
  }

  t(key: string, params?: Record<string, unknown>): string {
    const e = this.table[key] as Record<string, unknown> | undefined;
    for (const loc of [this.locale, ...this.fallback]) {
      const v = e?.[loc];
      if (typeof v === "string" && v !== "") {
        if (loc !== this.locale) this.missing.add(`${this.locale}:${key}`);
        return format(v, params);
      }
    }
    this.missing.add(`${this.locale}:${key}`);
    return key;
  }

  /** t() plus zero-width break hints for Thai (for PixiJS Text / canvas wrapping). */
  tw(key: string, params?: Record<string, unknown>): string {
    return thaiWrapHints(this.t(key, params));
  }

  keys() {
    return Object.keys(this.table);
  }
}

/** Thai letters, vowels and digits; the baht sign ฿ (U+0E3F) is a currency symbol used in every locale. */
const THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;
export const hasThai = (s: string) => THAI.test(s);

/**
 * Insert zero-width spaces between Thai words so renderers that only wrap at spaces (PixiJS Text, canvas) can break
 * lines. Uses Intl.Segmenter (ICU dictionary) when available; text without Thai is returned unchanged.
 */
export function thaiWrapHints(s: string, locale = "th"): string {
  if (!hasThai(s)) return s;
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return s;
  const parts = [...new Seg(locale, { granularity: "word" }).segment(s)].map((x) => x.segment);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    out += p;
    const next = parts[i + 1];
    if (next && hasThai(p) && hasThai(next)) out += "\u200b";
  }
  return out;
}
