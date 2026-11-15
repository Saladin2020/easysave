import { canon } from "./canon.js";
import { FIELD_NAME, FIELD_TYPES, MIGRATION_OPS, SAFE_ID, SCHEMA_FORMAT, type Diagnostic, type Field, type Migration, type MigrationOp, type Schema } from "./types.js";

export class Diags {
  list: Diagnostic[] = [];
  err(path: string, message: string) {
    this.list.push({ path, message, severity: "error" });
  }
  warn(path: string, message: string) {
    this.list.push({ path, message, severity: "warning" });
  }
  info(path: string, message: string) {
    this.list.push({ path, message, severity: "info" });
  }
  get errors() {
    return this.list.filter((d) => d.severity === "error");
  }
  get warnings() {
    return this.list.filter((d) => d.severity === "warning");
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const join = (p: string, k: string | number) => (p ? `${p}.${k}` : String(k));

// ---------------------------------------------------------------- schema shape

function checkField(f: unknown, p: string, d: Diags) {
  if (!isObj(f)) return d.err(p, "field must be an object { type, … }");
  if (!FIELD_TYPES.includes(f.type as "int")) return d.err(`${p}.type`, `one of ${FIELD_TYPES.join(", ")}`);
  if (f.type === "enum" && (!Array.isArray(f.values) || !f.values.length)) d.err(`${p}.values`, "enum needs values");
  if ((f.type === "list" || f.type === "map") && f.of === undefined) d.err(`${p}.of`, `${f.type} needs an element type (of)`);
  if (f.of !== undefined) checkField(f.of, `${p}.of`, d);
  if (f.type === "object") {
    if (!isObj(f.fields)) d.err(`${p}.fields`, "object needs fields");
    else for (const [k, sub] of Object.entries(f.fields)) {
      if (!FIELD_NAME.test(k)) d.err(`${p}.fields.${k}`, "field names: a-z, 0-9, _ (start with a letter or _)");
      checkField(sub, `${p}.fields.${k}`, d);
    }
  }
  for (const k of ["min", "max", "maxLength"] as const) if (f[k] !== undefined && typeof f[k] !== "number") d.err(`${p}.${k}`, "number");
  if (f.default !== undefined) {
    const sub = new Diags();
    validateValue(f as unknown as Field, f.default, `${p}.default`, sub);
    d.list.push(...sub.errors);
  }
}

export function checkSchema(raw: unknown, file = ""): { schema?: Schema; diagnostics: Diagnostic[] } {
  const d = new Diags();
  const at = (p: string) => (file ? `${file}:${p}` : p);
  if (!isObj(raw)) return { diagnostics: [{ path: at(""), message: "schema must be an object", severity: "error" }] };
  if (raw.format !== SCHEMA_FORMAT) d.err(at("format"), `must be "${SCHEMA_FORMAT}"`);
  if (typeof raw.id !== "string" || !SAFE_ID.test(raw.id)) d.err(at("id"), "id: a-z, 0-9, _ or -");
  if (!isInt(raw.version) || raw.version < 1) d.err(at("version"), "integer ≥ 1");
  if (!isObj(raw.slots) || !isInt(raw.slots.manual) || raw.slots.manual < 0 || raw.slots.manual > 99) d.err(at("slots.manual"), "integer 0..99");
  else if (raw.slots.autosave !== undefined) {
    const a = raw.slots.autosave;
    if (!isObj(a) || !isInt(a.keep) || a.keep < 1 || a.keep > 9) d.err(at("slots.autosave.keep"), "integer 1..9");
    if (!isObj(a) || typeof a.intervalSec !== "number" || a.intervalSec < 5) d.err(at("slots.autosave.intervalSec"), "seconds ≥ 5");
  }
  if (!isObj(raw.fields) || !Object.keys(raw.fields).length) d.err(at("fields"), "object with at least one field");
  else for (const [k, f] of Object.entries(raw.fields)) {
    if (!FIELD_NAME.test(k)) d.err(at(`fields.${k}`), "field names: a-z, 0-9, _ (start with a letter or _)");
    checkField(f, at(`fields.${k}`), d);
  }
  if (raw.migrations !== undefined) {
    if (!Array.isArray(raw.migrations)) d.err(at("migrations"), "array");
    else {
      const ms = raw.migrations as unknown[];
      ms.forEach((m, i) => {
        const p = at(`migrations[${i}]`);
        if (!isObj(m)) return d.err(p, "object { from, to, ops }");
        if (!isInt(m.from) || !isInt(m.to) || m.to !== m.from + 1) d.err(p, "from / to must be consecutive versions (to = from + 1)");
        if (!Array.isArray(m.ops)) return d.err(`${p}.ops`, "array");
        (m.ops as unknown[]).forEach((o, j) => checkOp(o, `${p}.ops[${j}]`, d));
      });
      if (isInt(raw.version)) {
        const froms = new Set(ms.filter(isObj).map((m) => m.from));
        const first = Math.min(...(froms.size ? [...froms].map(Number) : [raw.version]));
        for (let v = first; v < raw.version; v++) if (!froms.has(v)) d.err(at("migrations"), `no migration from v${v} to v${v + 1}`);
        for (const m of ms.filter(isObj)) if (isInt(m.to) && m.to > raw.version) d.err(at("migrations"), `migration to v${m.to} is newer than version ${raw.version}`);
        if (ms.filter(isObj).length !== froms.size) d.err(at("migrations"), "two migrations start at the same version");
      }
    }
  }
  return { schema: d.errors.length ? undefined : (raw as unknown as Schema), diagnostics: d.list };
}

function checkOp(o: unknown, p: string, d: Diags) {
  if (!isObj(o) || !MIGRATION_OPS.includes(o.op as "add")) return d.err(`${p}.op`, MIGRATION_OPS.join(" | "));
  const need = (k: string) => {
    if (typeof o[k] !== "string" || !String(o[k]).length) d.err(`${p}.${k}`, `"${o.op}" needs ${k}`);
  };
  if (o.op === "rename" || o.op === "copy") {
    need("from");
    need("to");
    if (typeof o.from === "string" && typeof o.to === "string" && o.from.split("*").length !== o.to.split("*").length) d.err(p, "from and to need the same number of *");
  } else need("path");
  if ((o.op === "add" || o.op === "set") && !("value" in o)) d.err(`${p}.value`, `"${o.op}" needs value`);
  if (o.op === "map" && !isObj(o.values)) d.err(`${p}.values`, '"map" needs values { old: new }');
}

// ---------------------------------------------------------------- defaults / validation / normalisation

export function defaultOf(f: Field): unknown {
  if (f.default !== undefined) return structuredClone(f.default);
  switch (f.type) {
    case "int":
    case "float":
    case "scalar":
      return f.min !== undefined && f.min > 0 ? f.min : 0;
    case "bool":
      return false;
    case "string":
      return "";
    case "enum":
      return f.values?.[0] ?? "";
    case "list":
      return [];
    case "map":
      return {};
    case "object":
      return Object.fromEntries(Object.entries(f.fields ?? {}).map(([k, sub]) => [k, defaultOf(sub)]));
    case "any":
      return null;
  }
}

export function defaults(schema: Schema): Record<string, unknown> {
  return defaultOf({ type: "object", fields: schema.fields }) as Record<string, unknown>;
}

/** Validate a value against a field without changing it. */
export function validateValue(f: Field, v: unknown, p: string, d: Diags): void {
  normalizeValue(f, v, p, d);
}

/**
 * Normalise a value: integral floats → ints for int fields (Godot JSON), missing object fields → defaults (info),
 * unknown object fields dropped (warning). Type and range problems are errors; the value is returned unchanged then.
 */
export function normalizeValue(f: Field, v: unknown, p: string, d: Diags): unknown {
  const range = (n: number) => {
    if (f.min !== undefined && n < f.min) d.err(p, `${n} is below min ${f.min}`);
    if (f.max !== undefined && n > f.max) d.err(p, `${n} is above max ${f.max}`);
  };
  switch (f.type) {
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) {
        d.err(p, `expected an integer, got ${canon(v)}`);
        return v;
      }
      range(v);
      return v;
    case "float":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        d.err(p, `expected a number, got ${canon(v)}`);
        return v;
      }
      range(v);
      return v;
    case "bool":
      if (typeof v !== "boolean") d.err(p, `expected true or false, got ${canon(v)}`);
      return v;
    case "string":
      if (typeof v !== "string") d.err(p, `expected text, got ${canon(v)}`);
      else if (f.maxLength !== undefined && [...v].length > f.maxLength) d.err(p, `longer than ${f.maxLength} characters`);
      return v;
    case "enum":
      if (!(f.values ?? []).some((x) => x === v)) d.err(p, `${canon(v)} is not one of ${(f.values ?? []).map((x) => canon(x)).join(", ")}`);
      return v;
    case "scalar":
      if (!["number", "string", "boolean"].includes(typeof v)) d.err(p, `expected a number, text or true/false, got ${canon(v)}`);
      return v;
    case "any":
      return v;
    case "list":
      if (!Array.isArray(v)) {
        d.err(p, `expected a list, got ${canon(v)}`);
        return v;
      }
      if (f.max !== undefined && v.length > f.max) d.err(p, `more than ${f.max} entries`);
      return v.map((x, i) => normalizeValue(f.of!, x, `${p}[${i}]`, d));
    case "map":
      if (!isObj(v)) {
        d.err(p, `expected an object (map), got ${canon(v)}`);
        return v;
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeValue(f.of!, x, join(p, k), d)]));
    case "object": {
      if (!isObj(v)) {
        d.err(p, `expected an object, got ${canon(v)}`);
        return v;
      }
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(f.fields ?? {})) {
        if (v[k] === undefined) {
          out[k] = defaultOf(sub);
          d.info(join(p, k), "missing, filled with the default");
        } else out[k] = normalizeValue(sub, v[k], join(p, k), d);
      }
      for (const k of Object.keys(v)) if (!(k in (f.fields ?? {}))) d.warn(join(p, k), "unknown field (dropped)");
      return out;
    }
  }
}

export function normalize(schema: Schema, data: unknown): { data: Record<string, unknown>; diagnostics: Diagnostic[] } {
  const d = new Diags();
  const out = normalizeValue({ type: "object", fields: schema.fields }, data, "", d) as Record<string, unknown>;
  return { data: out, diagnostics: d.list };
}

// ---------------------------------------------------------------- migrations

type Container = Record<string, unknown> | unknown[];

/** Expand a dotted path with * wildcards into concrete paths (+ the keys each * matched). */
export function expand(root: unknown, path: string): Array<{ parts: string[]; binds: string[] }> {
  const segs = path.split(".");
  let cur: Array<{ node: unknown; parts: string[]; binds: string[] }> = [{ node: root, parts: [], binds: [] }];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const next: typeof cur = [];
    for (const c of cur) {
      if (s === "*") {
        const keys = Array.isArray(c.node) ? c.node.map((_, j) => String(j)) : isObj(c.node) ? Object.keys(c.node) : [];
        for (const k of keys) next.push({ node: (c.node as Record<string, unknown>)[k], parts: [...c.parts, k], binds: [...c.binds, k] });
      } else {
        const node = isObj(c.node) || Array.isArray(c.node) ? (c.node as Record<string, unknown>)[s] : undefined;
        next.push({ node, parts: [...c.parts, s], binds: c.binds });
      }
    }
    cur = next;
  }
  return cur.map(({ parts, binds }) => ({ parts, binds }));
}

function getAt(root: unknown, parts: string[]): unknown {
  let n = root;
  for (const p of parts) {
    if (!isObj(n) && !Array.isArray(n)) return undefined;
    n = (n as Record<string, unknown>)[p];
  }
  return n;
}

function hasAt(root: unknown, parts: string[]): boolean {
  const parent = getAt(root, parts.slice(0, -1));
  return (isObj(parent) || Array.isArray(parent)) && Object.prototype.hasOwnProperty.call(parent, parts[parts.length - 1]!);
}

function setAt(root: Record<string, unknown>, parts: string[], v: unknown) {
  let n: Container = root;
  for (const p of parts.slice(0, -1)) {
    let next = (n as Record<string, unknown>)[p];
    if (!isObj(next) && !Array.isArray(next)) {
      next = {};
      (n as Record<string, unknown>)[p] = next;
    }
    n = next as Container;
  }
  (n as Record<string, unknown>)[parts[parts.length - 1]!] = v;
}

function deleteAt(root: unknown, parts: string[]) {
  const parent = getAt(root, parts.slice(0, -1));
  const k = parts[parts.length - 1]!;
  if (Array.isArray(parent)) parent.splice(Number(k), 1);
  else if (isObj(parent)) delete parent[k];
}

const bind = (pattern: string, binds: string[]) => {
  let i = 0;
  return pattern.split(".").map((s) => (s === "*" ? binds[i++]! : s));
};

const mapKey = (v: unknown) => (typeof v === "string" ? v : canon(v));

/** Apply one op in place; returns how many places it changed. */
export function applyOp(data: Record<string, unknown>, o: MigrationOp): number {
  let n = 0;
  switch (o.op) {
    case "rename":
    case "copy":
      for (const e of expand(data, o.from!)) {
        if (!hasAt(data, e.parts)) continue;
        const v = structuredClone(getAt(data, e.parts));
        if (o.op === "rename") deleteAt(data, e.parts);
        setAt(data, bind(o.to!, e.binds), v);
        n++;
      }
      return n;
    case "add":
    case "set":
      for (const e of expand(data, o.path!)) {
        if (o.op === "add" && hasAt(data, e.parts)) continue;
        setAt(data, e.parts, structuredClone(o.value));
        n++;
      }
      return n;
    case "delete":
      for (const e of expand(data, o.path!).reverse()) {
        if (!hasAt(data, e.parts)) continue;
        deleteAt(data, e.parts);
        n++;
      }
      return n;
    case "map":
      for (const e of expand(data, o.path!)) {
        if (!hasAt(data, e.parts)) continue;
        const k = mapKey(getAt(data, e.parts));
        if (Object.prototype.hasOwnProperty.call(o.values!, k)) {
          setAt(data, e.parts, structuredClone(o.values![k]));
          n++;
        }
      }
      return n;
    case "wrap":
      for (const e of expand(data, o.path!)) {
        if (!hasAt(data, e.parts)) continue;
        const v = getAt(data, e.parts);
        if (Array.isArray(v)) continue;
        setAt(data, e.parts, v === null || v === "" ? [] : [v]);
        n++;
      }
      return n;
  }
}

export interface MigrationResult {
  ok: boolean;
  data: Record<string, unknown>;
  version: number;
  steps: Array<{ from: number; to: number; changes: number[] }>;
  error?: string;
}

/** Run migrations from `fromVersion` to the schema version on a copy of the data. */
export function migrate(schema: Schema, data: Record<string, unknown>, fromVersion: number): MigrationResult {
  const out = structuredClone(data);
  const steps: MigrationResult["steps"] = [];
  let v = fromVersion;
  if (v > schema.version) return { ok: false, data: out, version: v, steps, error: `save is v${v}, newer than the game's v${schema.version}` };
  const ms: Migration[] = schema.migrations ?? [];
  while (v < schema.version) {
    const m = ms.find((x) => x.from === v);
    if (!m) return { ok: false, data: out, version: v, steps, error: `no migration from v${v}` };
    steps.push({ from: m.from, to: m.to, changes: m.ops.map((o) => applyOp(out, o)) });
    v = m.to;
  }
  return { ok: true, data: out, version: v, steps };
}
