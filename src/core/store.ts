import { normalize } from "./schema.js";
import { makeSlot, parseSlot, type LoadResult } from "./slot.js";
import type { Diagnostic, Schema, SlotFile, SlotMeta } from "./types.js";

/** Key-value storage: localStorage, a folder of files (CLI), or a Map (tests). Godot's SaveManager uses user://saves. */
export interface SaveStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface SlotInfo {
  slot: string;
  kind: "manual" | "quick" | "auto";
  exists: boolean;
  ok?: boolean;
  reason?: string;
  version?: number;
  meta?: SlotMeta;
  hasBackup?: boolean;
}

export interface SaveResult {
  ok: boolean;
  slot?: SlotFile;
  reason?: "invalid" | "bad_slot";
  diagnostics: Diagnostic[];
}

/**
 * Save slots for one schema. save() keeps the previous file as `<slot>.bak`; load() falls back to it when the main
 * file is corrupt or fails its checksum. autosave() rotates auto_0 → auto_1 … (keep N).
 */
export class SaveStore {
  constructor(
    readonly schema: Schema,
    readonly storage: SaveStorage,
    readonly opts: { prefix?: string; now?: () => string } = {},
  ) {}

  key(slot: string) {
    return `${this.opts.prefix ?? ""}${slot}.save.json`;
  }

  slots(): Array<{ slot: string; kind: SlotInfo["kind"] }> {
    const r = this.schema.slots;
    const out: Array<{ slot: string; kind: SlotInfo["kind"] }> = [];
    for (let i = 1; i <= r.manual; i++) out.push({ slot: `slot_${i}`, kind: "manual" });
    if (r.quick) out.push({ slot: "quick", kind: "quick" });
    for (let i = 0; i < (r.autosave?.keep ?? 0); i++) out.push({ slot: `auto_${i}`, kind: "auto" });
    return out;
  }

  isSlot(slot: string) {
    return this.slots().some((s) => s.slot === slot);
  }

  save(slot: string, data: unknown, meta: Partial<SlotMeta> = {}): SaveResult {
    if (!this.isSlot(slot)) return { ok: false, reason: "bad_slot", diagnostics: [{ path: "", message: `unknown slot "${slot}" (${this.slots().map((s) => s.slot).join(", ")})`, severity: "error" }] };
    const n = normalize(this.schema, data);
    if (n.diagnostics.some((d) => d.severity === "error")) return { ok: false, reason: "invalid", diagnostics: n.diagnostics };
    const file = makeSlot(this.schema, slot, n.data, { savedAt: meta.savedAt ?? this.opts.now?.() ?? new Date().toISOString(), ...meta });
    const key = this.key(slot);
    const prev = this.storage.get(key);
    if (prev !== null) this.storage.set(`${key}.bak`, prev);
    this.storage.set(key, `${JSON.stringify(file, null, 2)}\n`);
    return { ok: true, slot: file, diagnostics: n.diagnostics };
  }

  load(slot: string): LoadResult & { usedBackup?: boolean } {
    const key = this.key(slot);
    const main = parseSlot(this.schema, this.storage.get(key));
    if (main.ok || main.reason === "empty" && this.storage.get(`${key}.bak`) === null) return main;
    const bak = parseSlot(this.schema, this.storage.get(`${key}.bak`));
    if (bak.ok) return { ...bak, usedBackup: true, message: `main file: ${main.reason}${main.message ? ` (${main.message})` : ""}` };
    return main;
  }

  autosave(data: unknown, meta: Partial<SlotMeta> = {}): SaveResult {
    const keep = this.schema.slots.autosave?.keep ?? 0;
    if (!keep) return { ok: false, reason: "bad_slot", diagnostics: [{ path: "", message: "schema has no autosave", severity: "error" }] };
    const n = normalize(this.schema, data);
    if (n.diagnostics.some((d) => d.severity === "error")) return { ok: false, reason: "invalid", diagnostics: n.diagnostics };
    for (let i = keep - 1; i >= 1; i--) {
      const from = this.storage.get(this.key(`auto_${i - 1}`));
      if (from !== null) this.storage.set(this.key(`auto_${i}`), from);
    }
    return this.save("auto_0", n.data, meta);
  }

  remove(slot: string) {
    this.storage.remove(this.key(slot));
    this.storage.remove(`${this.key(slot)}.bak`);
  }

  list(): SlotInfo[] {
    return this.slots().map(({ slot, kind }) => {
      const text = this.storage.get(this.key(slot));
      const hasBackup = this.storage.get(`${this.key(slot)}.bak`) !== null;
      if (text === null) return { slot, kind, exists: false, hasBackup };
      const r = parseSlot(this.schema, text);
      let version: number | undefined;
      try {
        version = (JSON.parse(text) as SlotFile).version;
      } catch {
        /* reported by r */
      }
      return { slot, kind, exists: true, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }), version, meta: r.meta, hasBackup };
    });
  }

  /** True when an autosave is due (seconds since the last one ≥ intervalSec). */
  autosaveDue(secondsSinceLast: number) {
    const a = this.schema.slots.autosave;
    return !!a && secondsSinceLast >= a.intervalSec;
  }
}

