import { hasThai } from "../core/i18n.js";
import type { Extracted } from "./strings.js";

/**
 * String extraction from the other Easy Suite formats. Keys are stable and match what each tool uses at runtime:
 *   .ezd / .dialogue.json  dlg.<dialogue>.<line id>   (auto ids <node>_<n> and <node>_c<n>, or #line:id)
 *                          dlg.<dialogue>.title, dlg.<dialogue>.char.<id>
 *   .ezq                   quest.<file>.title, quest.<quest>.title|summary, quest.<quest>.step.<step>[.hint],
 *                          quest.flag.<id>, quest.item.<id>.name|desc
 *   .easyui.json           ui.<file>.<screen>.<widget>[.title|.label][.<i>]
 *   .easyitems.json        item.<id>.name|desc, shop.<id>.name, recipe.<id>.name (en / ms come along)
 */
export const SOURCE_EXTS = [".ezd", ".dialogue.json", ".ezq", ".easyui.json", ".easyitems.json"] as const;

export function sourceKind(file: string): (typeof SOURCE_EXTS)[number] | null {
  return SOURCE_EXTS.find((e) => file.endsWith(e)) ?? null;
}

const base = (file: string, ext: string) => file.replace(/^.*[\\/]/, "").slice(0, -ext.length);
const rel = (file: string) => file.replace(/\\/g, "/");

export function extractFile(file: string, text: string): Extracted[] {
  const kind = sourceKind(file);
  switch (kind) {
    case ".ezd":
      return extractEzd(file, text);
    case ".dialogue.json":
      return extractDialogueJson(file, JSON.parse(text));
    case ".ezq":
      return extractEzq(file, text);
    case ".easyui.json":
      return extractUi(file, JSON.parse(text));
    case ".easyitems.json":
      return extractItems(file, JSON.parse(text));
    default:
      return [];
  }
}

// ------------------------------------------------------------------ Easy Dialogue

const unescape = (s: string) => s.replace(/\\(.)/g, "$1");

/** Split trailing ` #tag` tokens (unescaped) off a line; returns text and tags. */
function splitTags(s: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  let t = s;
  for (;;) {
    const m = /(^|\s)#([^\s#]+)\s*$/.exec(t);
    if (!m || t[m.index + m[1]!.length - 1] === "\\") break;
    tags.unshift(m[2]!);
    t = t.slice(0, m.index).trimEnd();
  }
  return { text: t, tags };
}

export function extractEzd(file: string, src: string): Extracted[] {
  const out: Extracted[] = [];
  let doc = base(file, ".ezd");
  const lines = src.split(/\r?\n/);
  const head: Array<{ key: string; text: string; no: number; note: string }> = [];
  let node: string | null = null;
  let counter = 0;
  const push = (key: string, text: string, no: number, note?: string) => out.push({ key, text, src: `${rel(file)}:${no}`, table: "dialogue", ...(note ? { note } : {}) });
  lines.forEach((raw, i) => {
    const no = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    const hdr = /^===\s*([^\s#]+)/.exec(line);
    if (hdr) {
      node = hdr[1]!;
      counter = 0;
      return;
    }
    if (node === null) {
      let m: RegExpExecArray | null;
      if ((m = /^@id\s+(\S+)/.exec(line))) doc = m[1]!;
      else if ((m = /^@title\s+(.+)$/.exec(line))) head.push({ key: "title", text: m[1]!.trim(), no, note: "dialogue title" });
      else if ((m = /^@char\s+([a-z0-9_]+)\s+"([^"]*)"/.exec(line))) head.push({ key: `char.${m[1]}`, text: m[2]!, no, note: `character name (${m[1]})` });
      return;
    }
    if (/^(~|->|@)/.test(line) || /^(if|elif)\s.*:$/.test(line) || line === "else:") return;
    if (line.startsWith("*")) {
      let t = line.slice(1).trim();
      for (;;) {
        const b = /^\[(if\s[^\]]*|grey|gray|hide)\]\s*/.exec(t);
        if (!b) break;
        t = t.slice(b[0].length);
      }
      const { text, tags } = splitTags(t.replace(/\s*(?<!\\)->\s*\S+\s*$/, ""));
      const explicit = tags.find((x) => x.startsWith("line:"));
      const id = explicit ? explicit.slice(5) : `${node}_c${++counter}`;
      push(`dlg.${doc}.${id}`, unescape(text.trim()), no, "choice");
      return;
    }
    let body = line.startsWith(">") ? line.slice(1).trim() : line;
    let speaker: string | undefined;
    if (!line.startsWith(">")) {
      const m = /^([a-z0-9_]+)\s*(\[[^\]]*\])?\s*(?<!\\):\s*(.*)$/.exec(line);
      if (m) {
        speaker = m[1];
        body = m[3]!;
      }
    }
    const { text, tags } = splitTags(body);
    const explicit = tags.find((x) => x.startsWith("line:"));
    const id = explicit ? explicit.slice(5) : `${node}_${++counter}`;
    push(`dlg.${doc}.${id}`, unescape(text.trim()), no, speaker ? `line (${speaker})` : "narration");
  });
  return [...head.map((h) => ({ key: `dlg.${doc}.${h.key}`, text: h.text, src: `${rel(file)}:${h.no}`, table: "dialogue", note: h.note })), ...out];
}

interface DlgStmt {
  t: string;
  id?: string;
  text?: string;
  speaker?: string;
  src?: number;
  body?: DlgStmt[];
  branches?: Array<{ body: DlgStmt[] }>;
  options?: Array<{ id: string; text: string; src?: number; body?: DlgStmt[] }>;
}

export function extractDialogueJson(file: string, d: { id: string; title?: string; characters?: Record<string, { name?: string }>; nodes: Record<string, { body: DlgStmt[] }> }): Extracted[] {
  const out: Extracted[] = [];
  const at = (n?: number) => `${rel(file)}${n ? `:${n}` : ""}`;
  if (d.title) out.push({ key: `dlg.${d.id}.title`, text: d.title, src: at(), table: "dialogue", note: "dialogue title" });
  for (const [id, c] of Object.entries(d.characters ?? {})) if (c.name) out.push({ key: `dlg.${d.id}.char.${id}`, text: c.name, src: at(), table: "dialogue", note: `character name (${id})` });
  const walk = (body: DlgStmt[]) => {
    for (const s of body) {
      if (s.t === "line" && s.id && s.text !== undefined) out.push({ key: `dlg.${d.id}.${s.id}`, text: s.text, src: at(s.src), table: "dialogue", note: s.speaker ? `line (${s.speaker})` : "narration" });
      if (s.body) walk(s.body);
      for (const b of s.branches ?? []) walk(b.body);
      for (const o of s.options ?? []) {
        out.push({ key: `dlg.${d.id}.${o.id}`, text: o.text, src: at(o.src), table: "dialogue", note: "choice" });
        if (o.body) walk(o.body);
      }
    }
  };
  for (const n of Object.values(d.nodes)) walk(n.body);
  return out;
}

// ------------------------------------------------------------------ Easy Quest

export function extractEzq(file: string, src: string): Extracted[] {
  const out: Extracted[] = [];
  let fileId = base(file, ".ezq");
  let quest: string | null = null;
  let step: string | null = null;
  const push = (key: string, text: string, no: number, note: string) => out.push({ key, text: text.trim(), src: `${rel(file)}:${no}`, table: "quests", note });
  const pending: Array<[string, number]> = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    let m: RegExpExecArray | null;
    if ((m = /^@id\s+(\S+)/.exec(line))) fileId = m[1]!;
    else if ((m = /^@title\s+(.+)$/.exec(line))) pending.push([m[1]!, no]);
    else if ((m = /^@flag\s+([a-z0-9_]+).*?\blabel="([^"]*)"/.exec(line))) push(`quest.flag.${m[1]}`, m[2]!, no, "flag label");
    else if ((m = /^@item\s+([a-z0-9_]+)\s+"([^"]*)"(?:.*?\bdesc="([^"]*)")?/.exec(line))) {
      push(`quest.item.${m[1]}.name`, m[2]!, no, "quest item name");
      if (m[3]) push(`quest.item.${m[1]}.desc`, m[3], no, "quest item description");
    } else if ((m = /^===\s*([a-z0-9_]+)\s+"([^"]*)"/.exec(line))) {
      quest = m[1]!;
      step = null;
      push(`quest.${quest}.title`, m[2]!, no, "quest title");
    } else if (quest && (m = /^summary\s+(.+)$/.exec(line))) push(`quest.${quest}.summary`, m[1]!, no, "quest summary");
    else if (quest && (m = /^(step|bonus)\s+([a-z0-9_]+)\s+"([^"]*)"/.exec(line))) {
      step = m[2]!;
      push(`quest.${quest}.step.${step}`, m[3]!, no, m[1] === "bonus" ? "bonus step" : "step");
    } else if (quest && step && (m = /^hint\s+(.+)$/.exec(line))) push(`quest.${quest}.step.${step}.hint`, m[1]!, no, "step hint");
  });
  for (const [t, no] of pending) out.unshift({ key: `quest.${fileId}.file_title`, text: t.trim(), src: `${rel(file)}:${no}`, table: "quests", note: "quest file title" });
  return out;
}

// ------------------------------------------------------------------ Easy UI

interface UiDoc {
  screens: Record<string, { widgets: Array<Record<string, unknown>> }>;
}

export function extractUi(file: string, d: UiDoc): Extracted[] {
  const out: Extracted[] = [];
  const doc = base(file, ".easyui.json");
  const push = (key: string, text: string, note: string) => {
    if (!text.trim()) return;
    out.push({ key, text, src: `${rel(file)}`, table: "ui", note, ...(hasThai(text) ? {} : { en: text }) });
  };
  for (const [sn, s] of Object.entries(d.screens ?? {})) {
    for (const w of s.widgets ?? []) {
      const k = `ui.${doc}.${sn}.${String(w.id)}`;
      const type = String(w.type);
      if (typeof w.text === "string") push(k, w.text, `${type} text`);
      for (const f of ["title", "label"] as const) if (typeof w[f] === "string") push(`${k}.${f}`, w[f] as string, `${type} ${f}`);
      for (const f of ["items", "tabs"] as const) {
        const list = w[f];
        if (Array.isArray(list)) list.forEach((x, i) => typeof x === "string" && push(f === "items" ? `${k}.${i}` : `${k}.${f}.${i}`, x, `${type} ${f === "items" ? "item" : "tab"} ${i + 1}`));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ Easy Items

interface Txt {
  th?: string;
  en?: string;
  ms?: string;
}

export function extractItems(file: string, d: { items?: Array<{ id: string; name: Txt; desc?: Txt }>; shops?: Array<{ id: string; name: Txt }>; recipes?: Array<{ id: string; name: Txt }> }): Extracted[] {
  const out: Extracted[] = [];
  const push = (key: string, t: Txt | undefined, note: string) => {
    if (!t?.th) return;
    out.push({ key, text: t.th, ...(t.en ? { en: t.en } : {}), ...(t.ms ? { ms: t.ms } : {}), src: rel(file), table: "items", note });
  };
  for (const it of d.items ?? []) {
    push(`item.${it.id}.name`, it.name, "item name");
    push(`item.${it.id}.desc`, it.desc, "item description");
  }
  for (const s of d.shops ?? []) push(`shop.${s.id}.name`, s.name, "shop name");
  for (const r of d.recipes ?? []) push(`recipe.${r.id}.name`, r.name, "recipe name");
  return out;
}
