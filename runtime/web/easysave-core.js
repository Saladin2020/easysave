// Easy Save core runtime (generated from src/core by scripts/build-runtime.mjs; do not edit). MIT.

// src/core/types.ts
var SCHEMA_FORMAT = "easysave/1";
var SLOT_FORMAT = "easysave-slot/1";
var STRINGS_FORMAT = "easyi18n/1";
var LOCALES = ["th", "en", "ms"];
var FIELD_TYPES = ["int", "float", "bool", "string", "enum", "list", "map", "object", "scalar", "any"];
var MIGRATION_OPS = ["rename", "copy", "add", "set", "delete", "map", "wrap"];
var SAFE_ID = /^[a-z0-9_-]+$/;
var FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

// src/core/canon.ts
var MAX_SAFE = 9007199254740992;
function canonNumber(n) {
  if (!Number.isFinite(n)) return "null";
  if (Math.floor(n) === n && Math.abs(n) < MAX_SAFE) return n === 0 ? "0" : String(n);
  const q = Math.floor(n * 1e6 + 0.5);
  if (q === 0) return "0";
  const neg = q < 0;
  const a = Math.abs(q);
  const ip = Math.floor(a / 1e6);
  let frac = String(a - ip * 1e6).padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${ip}${frac ? `.${frac}` : ""}`;
}
function canonString(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "	") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 32) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}
function canon(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return canonNumber(v);
  if (typeof v === "string") return canonString(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v;
  const keys = Object.keys(o).filter((k) => o[k] !== void 0).sort(cmpCodePoints);
  return `{${keys.map((k) => `${canonString(k)}:${canon(o[k])}`).join(",")}}`;
}
function cmpCodePoints(a, b) {
  const A = [...a];
  const B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d) return d;
  }
  return A.length - B.length;
}
function utf8(s) {
  return new TextEncoder().encode(s);
}
function fnv1a32(s) {
  let h = 2166136261;
  for (const b of utf8(s)) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}
var checksumOf = (v) => fnv1a32(canon(v));

// src/core/schema.ts
var Diags = class {
  list = [];
  err(path, message) {
    this.list.push({ path, message, severity: "error" });
  }
  warn(path, message) {
    this.list.push({ path, message, severity: "warning" });
  }
  info(path, message) {
    this.list.push({ path, message, severity: "info" });
  }
  get errors() {
    return this.list.filter((d) => d.severity === "error");
  }
  get warnings() {
    return this.list.filter((d) => d.severity === "warning");
  }
};
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isInt = (v) => typeof v === "number" && Number.isInteger(v);
var join = (p, k) => p ? `${p}.${k}` : String(k);
function checkField(f, p, d) {
  if (!isObj(f)) return d.err(p, "field must be an object { type, \u2026 }");
  if (!FIELD_TYPES.includes(f.type)) return d.err(`${p}.type`, `one of ${FIELD_TYPES.join(", ")}`);
  if (f.type === "enum" && (!Array.isArray(f.values) || !f.values.length)) d.err(`${p}.values`, "enum needs values");
  if ((f.type === "list" || f.type === "map") && f.of === void 0) d.err(`${p}.of`, `${f.type} needs an element type (of)`);
  if (f.of !== void 0) checkField(f.of, `${p}.of`, d);
  if (f.type === "object") {
    if (!isObj(f.fields)) d.err(`${p}.fields`, "object needs fields");
    else for (const [k, sub] of Object.entries(f.fields)) {
      if (!FIELD_NAME.test(k)) d.err(`${p}.fields.${k}`, "field names: a-z, 0-9, _ (start with a letter or _)");
      checkField(sub, `${p}.fields.${k}`, d);
    }
  }
  for (const k of ["min", "max", "maxLength"]) if (f[k] !== void 0 && typeof f[k] !== "number") d.err(`${p}.${k}`, "number");
  if (f.default !== void 0) {
    const sub = new Diags();
    validateValue(f, f.default, `${p}.default`, sub);
    d.list.push(...sub.errors);
  }
}
function checkSchema(raw, file = "") {
  const d = new Diags();
  const at = (p) => file ? `${file}:${p}` : p;
  if (!isObj(raw)) return { diagnostics: [{ path: at(""), message: "schema must be an object", severity: "error" }] };
  if (raw.format !== SCHEMA_FORMAT) d.err(at("format"), `must be "${SCHEMA_FORMAT}"`);
  if (typeof raw.id !== "string" || !SAFE_ID.test(raw.id)) d.err(at("id"), "id: a-z, 0-9, _ or -");
  if (!isInt(raw.version) || raw.version < 1) d.err(at("version"), "integer \u2265 1");
  if (!isObj(raw.slots) || !isInt(raw.slots.manual) || raw.slots.manual < 0 || raw.slots.manual > 99) d.err(at("slots.manual"), "integer 0..99");
  else if (raw.slots.autosave !== void 0) {
    const a = raw.slots.autosave;
    if (!isObj(a) || !isInt(a.keep) || a.keep < 1 || a.keep > 9) d.err(at("slots.autosave.keep"), "integer 1..9");
    if (!isObj(a) || typeof a.intervalSec !== "number" || a.intervalSec < 5) d.err(at("slots.autosave.intervalSec"), "seconds \u2265 5");
  }
  if (!isObj(raw.fields) || !Object.keys(raw.fields).length) d.err(at("fields"), "object with at least one field");
  else for (const [k, f] of Object.entries(raw.fields)) {
    if (!FIELD_NAME.test(k)) d.err(at(`fields.${k}`), "field names: a-z, 0-9, _ (start with a letter or _)");
    checkField(f, at(`fields.${k}`), d);
  }
  if (raw.migrations !== void 0) {
    if (!Array.isArray(raw.migrations)) d.err(at("migrations"), "array");
    else {
      const ms = raw.migrations;
      ms.forEach((m, i) => {
        const p = at(`migrations[${i}]`);
        if (!isObj(m)) return d.err(p, "object { from, to, ops }");
        if (!isInt(m.from) || !isInt(m.to) || m.to !== m.from + 1) d.err(p, "from / to must be consecutive versions (to = from + 1)");
        if (!Array.isArray(m.ops)) return d.err(`${p}.ops`, "array");
        m.ops.forEach((o, j) => checkOp(o, `${p}.ops[${j}]`, d));
      });
      if (isInt(raw.version)) {
        const froms = new Set(ms.filter(isObj).map((m) => m.from));
        const first = Math.min(...froms.size ? [...froms].map(Number) : [raw.version]);
        for (let v = first; v < raw.version; v++) if (!froms.has(v)) d.err(at("migrations"), `no migration from v${v} to v${v + 1}`);
        for (const m of ms.filter(isObj)) if (isInt(m.to) && m.to > raw.version) d.err(at("migrations"), `migration to v${m.to} is newer than version ${raw.version}`);
        if (ms.filter(isObj).length !== froms.size) d.err(at("migrations"), "two migrations start at the same version");
      }
    }
  }
  return { schema: d.errors.length ? void 0 : raw, diagnostics: d.list };
}
function checkOp(o, p, d) {
  if (!isObj(o) || !MIGRATION_OPS.includes(o.op)) return d.err(`${p}.op`, MIGRATION_OPS.join(" | "));
  const need = (k) => {
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
function defaultOf(f) {
  if (f.default !== void 0) return structuredClone(f.default);
  switch (f.type) {
    case "int":
    case "float":
    case "scalar":
      return f.min !== void 0 && f.min > 0 ? f.min : 0;
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
function defaults(schema) {
  return defaultOf({ type: "object", fields: schema.fields });
}
function validateValue(f, v, p, d) {
  normalizeValue(f, v, p, d);
}
function normalizeValue(f, v, p, d) {
  const range = (n) => {
    if (f.min !== void 0 && n < f.min) d.err(p, `${n} is below min ${f.min}`);
    if (f.max !== void 0 && n > f.max) d.err(p, `${n} is above max ${f.max}`);
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
      else if (f.maxLength !== void 0 && [...v].length > f.maxLength) d.err(p, `longer than ${f.maxLength} characters`);
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
      if (f.max !== void 0 && v.length > f.max) d.err(p, `more than ${f.max} entries`);
      return v.map((x, i) => normalizeValue(f.of, x, `${p}[${i}]`, d));
    case "map":
      if (!isObj(v)) {
        d.err(p, `expected an object (map), got ${canon(v)}`);
        return v;
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeValue(f.of, x, join(p, k), d)]));
    case "object": {
      if (!isObj(v)) {
        d.err(p, `expected an object, got ${canon(v)}`);
        return v;
      }
      const out = {};
      for (const [k, sub] of Object.entries(f.fields ?? {})) {
        if (v[k] === void 0) {
          out[k] = defaultOf(sub);
          d.info(join(p, k), "missing, filled with the default");
        } else out[k] = normalizeValue(sub, v[k], join(p, k), d);
      }
      for (const k of Object.keys(v)) if (!(k in (f.fields ?? {}))) d.warn(join(p, k), "unknown field (dropped)");
      return out;
    }
  }
}
function normalize(schema, data) {
  const d = new Diags();
  const out = normalizeValue({ type: "object", fields: schema.fields }, data, "", d);
  return { data: out, diagnostics: d.list };
}
function expand(root, path) {
  const segs = path.split(".");
  let cur = [{ node: root, parts: [], binds: [] }];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = [];
    for (const c of cur) {
      if (s === "*") {
        const keys = Array.isArray(c.node) ? c.node.map((_, j) => String(j)) : isObj(c.node) ? Object.keys(c.node) : [];
        for (const k of keys) next.push({ node: c.node[k], parts: [...c.parts, k], binds: [...c.binds, k] });
      } else {
        const node = isObj(c.node) || Array.isArray(c.node) ? c.node[s] : void 0;
        next.push({ node, parts: [...c.parts, s], binds: c.binds });
      }
    }
    cur = next;
  }
  return cur.map(({ parts, binds }) => ({ parts, binds }));
}
function getAt(root, parts) {
  let n = root;
  for (const p of parts) {
    if (!isObj(n) && !Array.isArray(n)) return void 0;
    n = n[p];
  }
  return n;
}
function hasAt(root, parts) {
  const parent = getAt(root, parts.slice(0, -1));
  return (isObj(parent) || Array.isArray(parent)) && Object.prototype.hasOwnProperty.call(parent, parts[parts.length - 1]);
}
function setAt(root, parts, v) {
  let n = root;
  for (const p of parts.slice(0, -1)) {
    let next = n[p];
    if (!isObj(next) && !Array.isArray(next)) {
      next = {};
      n[p] = next;
    }
    n = next;
  }
  n[parts[parts.length - 1]] = v;
}
function deleteAt(root, parts) {
  const parent = getAt(root, parts.slice(0, -1));
  const k = parts[parts.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(k), 1);
  else if (isObj(parent)) delete parent[k];
}
var bind = (pattern, binds) => {
  let i = 0;
  return pattern.split(".").map((s) => s === "*" ? binds[i++] : s);
};
var mapKey = (v) => typeof v === "string" ? v : canon(v);
function applyOp(data, o) {
  let n = 0;
  switch (o.op) {
    case "rename":
    case "copy":
      for (const e of expand(data, o.from)) {
        if (!hasAt(data, e.parts)) continue;
        const v = structuredClone(getAt(data, e.parts));
        if (o.op === "rename") deleteAt(data, e.parts);
        setAt(data, bind(o.to, e.binds), v);
        n++;
      }
      return n;
    case "add":
    case "set":
      for (const e of expand(data, o.path)) {
        if (o.op === "add" && hasAt(data, e.parts)) continue;
        setAt(data, e.parts, structuredClone(o.value));
        n++;
      }
      return n;
    case "delete":
      for (const e of expand(data, o.path).reverse()) {
        if (!hasAt(data, e.parts)) continue;
        deleteAt(data, e.parts);
        n++;
      }
      return n;
    case "map":
      for (const e of expand(data, o.path)) {
        if (!hasAt(data, e.parts)) continue;
        const k = mapKey(getAt(data, e.parts));
        if (Object.prototype.hasOwnProperty.call(o.values, k)) {
          setAt(data, e.parts, structuredClone(o.values[k]));
          n++;
        }
      }
      return n;
    case "wrap":
      for (const e of expand(data, o.path)) {
        if (!hasAt(data, e.parts)) continue;
        const v = getAt(data, e.parts);
        if (Array.isArray(v)) continue;
        setAt(data, e.parts, v === null || v === "" ? [] : [v]);
        n++;
      }
      return n;
  }
}
function migrate(schema, data, fromVersion) {
  const out = structuredClone(data);
  const steps = [];
  let v = fromVersion;
  if (v > schema.version) return { ok: false, data: out, version: v, steps, error: `save is v${v}, newer than the game's v${schema.version}` };
  const ms = schema.migrations ?? [];
  while (v < schema.version) {
    const m = ms.find((x) => x.from === v);
    if (!m) return { ok: false, data: out, version: v, steps, error: `no migration from v${v}` };
    steps.push({ from: m.from, to: m.to, changes: m.ops.map((o) => applyOp(out, o)) });
    v = m.to;
  }
  return { ok: true, data: out, version: v, steps };
}

// src/core/slot.ts
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var checksumBody = (s) => ({ game: s.game, version: s.version, meta: s.meta, data: s.data });
function makeSlot(schema, slot, data, meta) {
  const m = { playtime: 0, ...meta };
  const body = { game: schema.id, version: schema.version, meta: m, data };
  return { format: SLOT_FORMAT, game: schema.id, version: schema.version, slot, meta: m, data, checksum: checksumOf(body) };
}
function verifySlot(raw) {
  if (!isObj2(raw) || raw.format !== SLOT_FORMAT) return { ok: false, reason: "not_a_save" };
  if (!isObj2(raw.data) || !isObj2(raw.meta) || typeof raw.checksum !== "string") return { ok: false, reason: "not_a_save" };
  const actual = checksumOf(checksumBody(raw));
  return actual === raw.checksum ? { ok: true, actual } : { ok: false, reason: "checksum", expected: raw.checksum, actual };
}
function readSlot(schema, raw) {
  const v = verifySlot(raw);
  if (!v.ok) return { ok: false, reason: v.reason, message: v.reason === "checksum" ? `checksum ${v.actual} does not match ${v.expected}` : "not an easysave-slot/1 file", diagnostics: [] };
  const s = raw;
  if (s.game !== schema.id) return { ok: false, reason: "wrong_game", message: `save is for "${s.game}", not "${schema.id}"`, diagnostics: [] };
  if (!Number.isInteger(s.version) || s.version > schema.version) return { ok: false, reason: "too_new", message: `save is v${s.version}, the game is v${schema.version}`, diagnostics: [] };
  const m = migrate(schema, s.data, s.version);
  if (!m.ok) return { ok: false, reason: "migration", message: m.error, diagnostics: [] };
  const n = normalize(schema, m.data);
  const errors = n.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) return { ok: false, reason: "invalid", message: `${errors.length} invalid field(s)`, diagnostics: n.diagnostics };
  return { ok: true, slot: s.slot, data: n.data, meta: s.meta, ...s.version < schema.version ? { migratedFrom: s.version } : {}, diagnostics: n.diagnostics };
}
function parseSlot(schema, text) {
  if (text === null || text === void 0) return { ok: false, reason: "empty", diagnostics: [] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: "parse", message: e instanceof Error ? e.message : String(e), diagnostics: [] };
  }
  return readSlot(schema, raw);
}

// src/core/store.ts
var SaveStore = class {
  constructor(schema, storage, opts = {}) {
    this.schema = schema;
    this.storage = storage;
    this.opts = opts;
  }
  schema;
  storage;
  opts;
  key(slot) {
    return `${this.opts.prefix ?? ""}${slot}.save.json`;
  }
  slots() {
    const r = this.schema.slots;
    const out = [];
    for (let i = 1; i <= r.manual; i++) out.push({ slot: `slot_${i}`, kind: "manual" });
    if (r.quick) out.push({ slot: "quick", kind: "quick" });
    for (let i = 0; i < (r.autosave?.keep ?? 0); i++) out.push({ slot: `auto_${i}`, kind: "auto" });
    return out;
  }
  isSlot(slot) {
    return this.slots().some((s) => s.slot === slot);
  }
  save(slot, data, meta = {}) {
    if (!this.isSlot(slot)) return { ok: false, reason: "bad_slot", diagnostics: [{ path: "", message: `unknown slot "${slot}" (${this.slots().map((s) => s.slot).join(", ")})`, severity: "error" }] };
    const n = normalize(this.schema, data);
    if (n.diagnostics.some((d) => d.severity === "error")) return { ok: false, reason: "invalid", diagnostics: n.diagnostics };
    const file = makeSlot(this.schema, slot, n.data, { savedAt: meta.savedAt ?? this.opts.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(), ...meta });
    const key = this.key(slot);
    const prev = this.storage.get(key);
    if (prev !== null) this.storage.set(`${key}.bak`, prev);
    this.storage.set(key, `${JSON.stringify(file, null, 2)}
`);
    return { ok: true, slot: file, diagnostics: n.diagnostics };
  }
  load(slot) {
    const key = this.key(slot);
    const main = parseSlot(this.schema, this.storage.get(key));
    if (main.ok || main.reason === "empty" && this.storage.get(`${key}.bak`) === null) return main;
    const bak = parseSlot(this.schema, this.storage.get(`${key}.bak`));
    if (bak.ok) return { ...bak, usedBackup: true, message: `main file: ${main.reason}${main.message ? ` (${main.message})` : ""}` };
    return main;
  }
  autosave(data, meta = {}) {
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
  remove(slot) {
    this.storage.remove(this.key(slot));
    this.storage.remove(`${this.key(slot)}.bak`);
  }
  list() {
    return this.slots().map(({ slot, kind }) => {
      const text = this.storage.get(this.key(slot));
      const hasBackup = this.storage.get(`${this.key(slot)}.bak`) !== null;
      if (text === null) return { slot, kind, exists: false, hasBackup };
      const r = parseSlot(this.schema, text);
      let version;
      try {
        version = JSON.parse(text).version;
      } catch {
      }
      return { slot, kind, exists: true, ok: r.ok, ...r.ok ? {} : { reason: r.reason }, version, meta: r.meta, hasBackup };
    });
  }
  /** True when an autosave is due (seconds since the last one ≥ intervalSec). */
  autosaveDue(secondsSinceLast) {
    const a = this.schema.slots.autosave;
    return !!a && secondsSinceLast >= a.intervalSec;
  }
};

// src/core/i18n.ts
function mergeTables(docs) {
  const out = {};
  for (const d of docs) Object.assign(out, d.strings);
  return out;
}
var PH = /\{([a-zA-Z0-9_]+)\}/g;
function placeholders(s) {
  return [...s.matchAll(PH)].map((m) => m[1]).sort();
}
function format(s, params = {}) {
  return s.replace(PH, (all, k) => k in params ? String(params[k]) : all);
}
var I18n = class {
  locale;
  fallback;
  table;
  missing = /* @__PURE__ */ new Set();
  constructor(tables, opts = {}) {
    this.table = Array.isArray(tables) ? mergeTables(tables) : tables;
    this.locale = opts.locale ?? "th";
    this.fallback = opts.fallback ?? ["en", "th"];
  }
  setLocale(locale) {
    this.locale = locale;
  }
  has(key, locale = this.locale) {
    const e = this.table[key];
    return !!e && typeof e[locale] === "string" && e[locale] !== "";
  }
  t(key, params) {
    const e = this.table[key];
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
  tw(key, params) {
    return thaiWrapHints(this.t(key, params));
  }
  keys() {
    return Object.keys(this.table);
  }
};
var THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;
var hasThai = (s) => THAI.test(s);
function thaiWrapHints(s, locale = "th") {
  if (!hasThai(s)) return s;
  const Seg = Intl.Segmenter;
  if (!Seg) return s;
  const parts = [...new Seg(locale, { granularity: "word" }).segment(s)].map((x) => x.segment);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    out += p;
    const next = parts[i + 1];
    if (next && hasThai(p) && hasThai(next)) out += "\u200B";
  }
  return out;
}
export {
  Diags,
  FIELD_NAME,
  FIELD_TYPES,
  I18n,
  LOCALES,
  MIGRATION_OPS,
  SAFE_ID,
  SCHEMA_FORMAT,
  SLOT_FORMAT,
  STRINGS_FORMAT,
  SaveStore,
  applyOp,
  canon,
  canonNumber,
  canonString,
  checkSchema,
  checksumBody,
  checksumOf,
  cmpCodePoints,
  defaultOf,
  defaults,
  expand,
  fnv1a32,
  format,
  hasThai,
  makeSlot,
  mergeTables,
  migrate,
  normalize,
  normalizeValue,
  parseSlot,
  placeholders,
  readSlot,
  thaiWrapHints,
  validateValue,
  verifySlot
};
