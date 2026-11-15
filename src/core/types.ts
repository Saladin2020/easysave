export const SCHEMA_FORMAT = "easysave/1";
export const SLOT_FORMAT = "easysave-slot/1";
export const STRINGS_FORMAT = "easyi18n/1";
export const LOCALES = ["th", "en", "ms"] as const;
export type Locale = (typeof LOCALES)[number];
export const FIELD_TYPES = ["int", "float", "bool", "string", "enum", "list", "map", "object", "scalar", "any"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const MIGRATION_OPS = ["rename", "copy", "add", "set", "delete", "map", "wrap"] as const;
export type MigrationOpName = (typeof MIGRATION_OPS)[number];
export const SAFE_ID = /^[a-z0-9_-]+$/;
export const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

export interface Field {
  type: FieldType;
  default?: unknown;
  min?: number;
  max?: number;
  /** string: maximum length in characters (grapheme-agnostic code points). */
  maxLength?: number;
  /** enum values. */
  values?: Array<string | number>;
  /** list / map element type. */
  of?: Field;
  /** object fields. */
  fields?: Record<string, Field>;
  desc?: string;
}

export interface MigrationOp {
  op: MigrationOpName;
  /** rename / copy source. */
  from?: string;
  /** rename / copy target. */
  to?: string;
  /** add / set / delete / map / wrap target. `*` matches every list index or map key. */
  path?: string;
  value?: unknown;
  /** map: old value (as text) → new value. */
  values?: Record<string, unknown>;
}

export interface Migration {
  from: number;
  to: number;
  note?: string;
  ops: MigrationOp[];
}

export interface SlotRules {
  /** Manual slots slot_1..slot_N. */
  manual: number;
  /** quick save slot "quick". */
  quick?: boolean;
  autosave?: { intervalSec: number; keep: number };
}

export interface Schema {
  format: typeof SCHEMA_FORMAT;
  id: string;
  name?: { th: string; en: string; ms?: string };
  version: number;
  slots: SlotRules;
  fields: Record<string, Field>;
  migrations?: Migration[];
}

export interface SlotMeta {
  savedAt: string;
  playtime: number;
  label?: string;
  locale?: string;
  [k: string]: unknown;
}

export interface SlotFile {
  format: typeof SLOT_FORMAT;
  game: string;
  version: number;
  slot: string;
  meta: SlotMeta;
  data: Record<string, unknown>;
  checksum: string;
}

export interface Diagnostic {
  path: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface StringEntry {
  th?: string;
  en?: string;
  ms?: string;
  note?: string;
  src?: string;
  /** Locales whose translation predates a change of the source text. */
  stale?: string[];
  /** Maximum length in characters (UI). */
  max?: number;
  /** Same text in every locale by design (language names, logos): only the source is stored. */
  fixed?: boolean;
}

export interface StringsDoc {
  format: typeof STRINGS_FORMAT;
  id: string;
  source: Locale;
  locales: Locale[];
  strings: Record<string, StringEntry>;
}
