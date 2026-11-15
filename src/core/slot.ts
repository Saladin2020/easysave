import { checksumOf } from "./canon.js";
import { migrate, normalize } from "./schema.js";
import { SLOT_FORMAT, type Diagnostic, type Schema, type SlotFile, type SlotMeta } from "./types.js";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What the checksum covers: game, version, meta and data. Not the slot name, so a file can be copied or rotated to
 * another slot (auto_0 → auto_1, slot_1 → slot_2) and still verify.
 */
export const checksumBody = (s: Pick<SlotFile, "game" | "version" | "meta" | "data">) => ({ game: s.game, version: s.version, meta: s.meta, data: s.data });

export function makeSlot(schema: Schema, slot: string, data: Record<string, unknown>, meta: Partial<SlotMeta> & { savedAt: string }): SlotFile {
  const m: SlotMeta = { playtime: 0, ...meta };
  const body = { game: schema.id, version: schema.version, meta: m, data };
  return { format: SLOT_FORMAT, game: schema.id, version: schema.version, slot, meta: m, data, checksum: checksumOf(body) };
}

export function verifySlot(raw: unknown): { ok: boolean; expected?: string; actual?: string; reason?: string } {
  if (!isObj(raw) || raw.format !== SLOT_FORMAT) return { ok: false, reason: "not_a_save" };
  if (!isObj(raw.data) || !isObj(raw.meta) || typeof raw.checksum !== "string") return { ok: false, reason: "not_a_save" };
  const actual = checksumOf(checksumBody(raw as unknown as SlotFile));
  return actual === raw.checksum ? { ok: true, actual } : { ok: false, reason: "checksum", expected: raw.checksum, actual };
}

export type LoadReason = "empty" | "parse" | "not_a_save" | "wrong_game" | "checksum" | "too_new" | "migration" | "invalid";

export interface LoadResult {
  ok: boolean;
  reason?: LoadReason;
  message?: string;
  slot?: string;
  data?: Record<string, unknown>;
  meta?: SlotMeta;
  /** Version the file was written with, when it was migrated. */
  migratedFrom?: number;
  diagnostics: Diagnostic[];
}

/** Verify, migrate and normalise a parsed slot file. */
export function readSlot(schema: Schema, raw: unknown): LoadResult {
  const v = verifySlot(raw);
  if (!v.ok) return { ok: false, reason: v.reason as LoadReason, message: v.reason === "checksum" ? `checksum ${v.actual} does not match ${v.expected}` : "not an easysave-slot/1 file", diagnostics: [] };
  const s = raw as SlotFile;
  if (s.game !== schema.id) return { ok: false, reason: "wrong_game", message: `save is for "${s.game}", not "${schema.id}"`, diagnostics: [] };
  if (!Number.isInteger(s.version) || s.version > schema.version) return { ok: false, reason: "too_new", message: `save is v${s.version}, the game is v${schema.version}`, diagnostics: [] };
  const m = migrate(schema, s.data, s.version);
  if (!m.ok) return { ok: false, reason: "migration", message: m.error, diagnostics: [] };
  const n = normalize(schema, m.data);
  const errors = n.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) return { ok: false, reason: "invalid", message: `${errors.length} invalid field(s)`, diagnostics: n.diagnostics };
  return { ok: true, slot: s.slot, data: n.data, meta: s.meta, ...(s.version < schema.version ? { migratedFrom: s.version } : {}), diagnostics: n.diagnostics };
}

export function parseSlot(schema: Schema, text: string | null | undefined): LoadResult {
  if (text === null || text === undefined) return { ok: false, reason: "empty", diagnostics: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: "parse", message: e instanceof Error ? e.message : String(e), diagnostics: [] };
  }
  return readSlot(schema, raw);
}
