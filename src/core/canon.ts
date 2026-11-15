/**
 * Canonical JSON and the save checksum. Mirrored exactly by runtime/godot/save_manager.gd, so a save written by the
 * CLI, the web runtime or Godot verifies everywhere.
 *
 * - object keys sorted (code point order), no whitespace;
 * - integral numbers (|n| < 2^53) as integers: Godot's JSON parser returns floats, so 3.0 and 3 are the same;
 * - other numbers rounded to 6 decimals as floor(n × 1e6 + 0.5), trailing zeros dropped;
 * - strings escaped like JSON.stringify (", \, \b \f \n \r \t, other control characters as \u00xx), UTF-8 kept.
 */
const MAX_SAFE = 9007199254740992;

export function canonNumber(n: number): string {
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

export function canonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

export function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return canonNumber(v);
  if (typeof v === "string") return canonString(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(cmpCodePoints);
  return `{${keys.map((k) => `${canonString(k)}:${canon(o[k])}`).join(",")}}`;
}

/** Code point order (the same order GDScript's Array.sort() gives Strings). */
export function cmpCodePoints(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i]!.codePointAt(0)! - B[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return A.length - B.length;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** FNV-1a 32-bit over UTF-8 bytes, as 8 lowercase hex digits. */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (const b of utf8(s)) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export const checksumOf = (v: unknown) => fnv1a32(canon(v));
