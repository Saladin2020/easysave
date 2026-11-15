import type { Diagnostic, Locale, Schema, SlotFile, StringEntry, StringsDoc } from "../../src/core/types";
import type { LoadResult } from "../../src/core/slot";
import type { SaveResult, SlotInfo } from "../../src/core/store";
import type { Coverage } from "../../src/shared/strings";

/** Mirrors lib/workspace WorkspaceCheck (kept here so the web build never pulls Node modules). */
export interface WorkspaceCheck {
  ok: boolean;
  schemas: Array<{ id: string; version?: number; diagnostics: Diagnostic[] }>;
  saves: Array<{ id: string; ok: boolean; version?: number; reason?: string; migratedFrom?: number; checksum: string }>;
  strings: { tables: number; keys: number; coverage: Coverage[]; diagnostics: Diagnostic[] };
  extraction: { missing: number; orphans: number };
}

export interface WorkspaceInfo {
  root: string;
  config: { name: string; sources: string[]; locales: Locale[]; sourceLocale: Locale };
  schemas: Array<{ id: string; version?: number; errors: number }>;
  fieldTypes: string[];
  migrationOps: string[];
  locales: Locale[];
  presets: string[];
}

export interface StringsResponse {
  tables: StringsDoc[];
  coverage: WorkspaceCheck["strings"]["coverage"];
  diagnostics: Diagnostic[];
  sourceKeysMissing: number;
  orphans: Array<{ table: string; key: string }>;
}

export interface MigrateResponse {
  ok: boolean;
  error?: string;
  steps: Array<{ from: number; to: number; changes: number[] }>;
  data?: Record<string, unknown>;
  diagnostics?: Diagnostic[];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok && body.error) throw new Error(body.error);
  return body;
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceInfo>(r));
export const fetchCheck = () => fetch("/api/check").then((r) => json<WorkspaceCheck>(r));
export const fetchSchema = () => fetch("/api/schema").then((r) => json<{ schema: Schema; defaults: Record<string, unknown> }>(r));
export const writeSchema = (id: string, schema: unknown, dryRun: boolean) => post(`/api/schema/${id}`, { schema, dryRun }).then((r) => json<{ ok: boolean; diagnostics: Diagnostic[] }>(r));
export const fetchSlots = () => fetch("/api/slots").then((r) => json<{ slots: SlotInfo[] }>(r));
export const fetchSlot = (slot: string) => fetch(`/api/slots/${slot}`).then((r) => json<{ result: LoadResult & { usedBackup?: boolean }; file: SlotFile | null }>(r));
export const saveSlot = (slot: string, data: unknown, label?: string) => post(`/api/slots/${slot}`, { data, label }).then((r) => json<SaveResult>(r));
export const deleteSlot = (slot: string) => fetch(`/api/slots/${slot}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r));
export const validateSave = (save: unknown) => post("/api/validate", { save }).then((r) => json<{ checksum: { ok: boolean; expected?: string; actual?: string; reason?: string }; result: LoadResult }>(r));
export const migrateData = (data: unknown, version: number) => post("/api/migrate", { data, version }).then((r) => json<MigrateResponse>(r));
export const fetchStrings = () => fetch("/api/strings").then((r) => json<StringsResponse>(r));
export const setString = (table: string, key: string, locale: Locale, text: string) => post(`/api/strings/${table}/set`, { key, locale, text }).then((r) => json<{ ok: boolean; entry: StringEntry; diagnostics: Diagnostic[] }>(r));
export const extract = (dryRun: boolean, prune = false) => post("/api/extract", { dryRun, prune }).then((r) => json<{ files: string[]; tables: Record<string, { total: number; added: string[]; changed: string[]; orphans: string[] }>; errors: Diagnostic[] }>(r));
export const exportSave = (preset: string) => post("/api/export", { preset }).then((r) => json<{ dirs: string[]; files: number; keys: number; saves: number }>(r));
