import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canon, checksumOf } from "../core/canon.js";
import { format, mergeTables } from "../core/i18n.js";
import { checksumBody, makeSlot, readSlot } from "../core/slot.js";
import { defaults } from "../core/schema.js";
import type { Locale, Schema, SlotFile, StringEntry, StringsDoc } from "../core/types.js";
import { toCsv } from "../shared/csv.js";
import { THAI_FONTS, fontNotesText } from "../shared/fonts.js";
import { toPo } from "../shared/po.js";
import { FONT_DIR, RUNTIME_DIR } from "./assets.js";
import { SAVE_EXT, dirs, loadConfig, loadSchema, loadStrings, resolveInside } from "./workspace.js";

export const EXPORT_PRESETS = ["godot", "web", "strings", "all"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];
const VERSION = "0.1.0";

export interface ExportOptions {
  preset?: ExportPreset;
  out?: string;
  /** Skip the workspace check on out (CLI with an explicit absolute path the user typed). */
  trustedPaths?: boolean;
}

export interface ExportResult {
  dirs: string[];
  files: string[];
  keys: number;
  saves: number;
}

class Writer {
  files: string[] = [];
  constructor(readonly dir: string) {}
  async write(rel: string, body: string | Buffer) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
  }
  async copy(src: string, rel: string) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await copyFile(src, f);
    this.files.push(f);
  }
}

interface Bundle {
  schema: Schema;
  docs: StringsDoc[];
  locales: Locale[];
  source: Locale;
  saves: Array<{ id: string; text: string }>;
}

async function bundle(root: string): Promise<Bundle> {
  const schema = await loadSchema(root);
  const cfg = await loadConfig(root);
  const docs = await loadStrings(root);
  const sd = dirs(root).saves;
  const saves = existsSync(sd) ? readdirSync(sd).filter((f) => f.endsWith(SAVE_EXT)).sort().map((f) => ({ id: f.slice(0, -SAVE_EXT.length), text: readFileSync(path.join(sd, f), "utf8") })) : [];
  return { schema, docs, locales: cfg.locales, source: cfg.sourceLocale, saves };
}

/** Runtime value of a key in a locale: the translation, else the fallback chain (en, then the source), fixed → source. */
export function runtimeText(e: StringEntry, loc: Locale, source: Locale): string {
  const r = e as Record<string, unknown>;
  for (const l of e.fixed ? [source] : [loc, "en", source]) if (typeof r[l] === "string" && r[l] !== "") return r[l] as string;
  return "";
}

/** strings.json for the runtimes: { locales, source, strings: { key: { th, en, ms } } } with fallbacks filled. */
function runtimeStrings(b: Bundle, fill: boolean) {
  const merged = mergeTables(b.docs);
  const strings: Record<string, Record<string, string>> = {};
  for (const k of Object.keys(merged).sort()) {
    const e = merged[k]!;
    strings[k] = Object.fromEntries(b.locales.map((l) => [l, fill ? runtimeText(e, l, b.source) : String((e as Record<string, unknown>)[l] ?? (e.fixed ? (e as Record<string, unknown>)[b.source] : "") ?? "")]));
  }
  return { format: "easyi18n-runtime/1", locales: b.locales, source: b.source, fallback: ["en", b.source], strings };
}

export async function exportSave(root: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const b = await bundle(root);
  const preset = opts.preset ?? "all";
  if (!EXPORT_PRESETS.includes(preset)) throw new Error(`Unknown preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  if (preset === "all" && opts.out) throw new Error("--out needs a single preset (godot, web or strings)");
  const presets: ExportPreset[] = preset === "all" ? ["godot", "web", "strings"] : [preset];
  const res: ExportResult = { dirs: [], files: [], keys: Object.keys(mergeTables(b.docs)).length, saves: b.saves.length };
  for (const p of presets) {
    const out = opts.out ? (opts.trustedPaths ? path.resolve(root, opts.out) : resolveInside(root, opts.out)) : path.join(dirs(root).exports, `easysave-${p}`);
    const w = new Writer(out);
    if (p === "strings") await exportStrings(w, b);
    if (p === "web") await exportWeb(w, b);
    if (p === "godot") await exportGodot(w, b);
    res.dirs.push(out);
    res.files.push(...w.files);
  }
  return res;
}

// ------------------------------------------------------------------ strings (for translators)

async function exportStrings(w: Writer, b: Bundle) {
  await w.write("strings.csv", toCsv(b.docs, b.locales));
  for (const l of b.locales) if (l !== b.source) await w.write(`${l}.po`, toPo(b.docs, l, b.source));
  await w.write("strings.json", `${JSON.stringify(runtimeStrings(b, false), null, 2)}\n`);
  for (const d of b.docs) await w.write(`tables/${d.id}.easyi18n.json`, `${JSON.stringify(d, null, 2)}\n`);
  await w.write("FONTS.txt", `${fontNotesText()}\n`);
  await w.write("README.txt", `Easy Save ${VERSION} · strings export

  strings.csv        keys,${b.locales.join(",")}: every table, blanks where a translation is missing (Godot CSV / spreadsheets)
  <locale>.po        gettext PO per target locale: msgctxt = key, msgid = ${b.source} source, msgstr = translation
  strings.json       merged key → { ${b.locales.join(", ")} } (no fallbacks filled)
  tables/            the easyi18n/1 tables as they are in the workspace
  FONTS.txt          Thai font and line-breaking notes

Import edited files back with:  easysave strings-import strings.csv   /   easysave strings-import ms.po
`);
}

// ------------------------------------------------------------------ web

async function exportWeb(w: Writer, b: Bundle) {
  await w.write("schema.json", `${JSON.stringify(b.schema, null, 2)}\n`);
  await w.write("strings.json", `${JSON.stringify(runtimeStrings(b, true), null, 2)}\n`);
  await w.copy(path.join(RUNTIME_DIR, "web", "easysave-core.js"), "easysave-core.js");
  await w.copy(path.join(RUNTIME_DIR, "web", "easysave-web.js"), "easysave-web.js");
  for (const s of b.saves) await w.write(`saves/${s.id}${SAVE_EXT}`, s.text);
  await w.write("saves/index.json", `${JSON.stringify(b.saves.map((s) => s.id))}\n`);
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `fonts/${f}`);
  await w.write("index.html", webDemo(b));
  await w.write("README.txt", `Easy Save ${VERSION} · web / PixiJS export

Serve this folder over HTTP (fetch needs it):  python3 -m http.server   then open index.html

  easysave-core.js   SaveStore (slots, checksum, migrations, .bak, autosave rotation), I18n, thaiWrapHints (no deps)
  easysave-web.js    loadEasySave(".") → { schema, saves (localStorage), i18n, startAutosave }
  schema.json        ${b.schema.id} v${b.schema.version}
  strings.json       ${b.locales.join(" / ")} with fallbacks filled (missing → en → ${b.source})
  saves/             sample saves (the demo copies them into localStorage on first run)
  fonts/             Kanit (SIL OFL 1.1) for Thai

  import { loadEasySave } from "./easysave-web.js";
  const es = await loadEasySave(".");
  es.saves.save("slot_1", data, { label: "ตลาดเช้า" });
  const r = es.saves.load("slot_1");          // { ok, data, meta, migratedFrom, usedBackup }
  text.text = es.i18n.tw("save.title");       // PixiJS Text: tw() adds Thai word-break hints

${fontNotesText()}
`);
}

function webDemo(b: Bundle): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Easy Save · web demo</title>
  <link rel="icon" href="data:," />
  <style>
    @font-face { font-family: Kanit; src: url(fonts/Kanit-Regular.ttf); }
    html, body { margin: 0; min-height: 100vh; background: #140e0a; color: #f7ebd3; font-family: Kanit, system-ui, sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 24px; }
    h1 { color: #f4ae3d; font-weight: 500; margin: 0 0 4px; }
    .bar { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
    button { background: #3a2819; color: #f7ebd3; border: 1px solid #523822; padding: 5px 12px; font: inherit; cursor: pointer; }
    button.on { background: #f4ae3d; color: #2a1606; }
    .slot { display: grid; grid-template-columns: 150px 1fr auto; gap: 10px; align-items: center; background: #2e2014; border: 2px solid #1a1008; padding: 10px 12px; margin: 6px 0; }
    .slot b { color: #f4ae3d; font-weight: 500; }
    .slot small { color: #b8a080; display: block; }
    .bad { color: #e0604a; } .ok { color: #8fd18a; }
    #log { background: #0e0a07; color: #b8a080; padding: 8px 10px; min-height: 60px; white-space: pre-wrap; font-size: 13px; }
  </style>
</head>
<body>
<main>
  <h1 id="title"></h1>
  <div id="sub" style="color:#b8a080"></div>
  <div class="bar" id="langs"></div>
  <div id="slots"></div>
  <div class="bar">
    <button id="play">+ 10 ฿ · next day</button>
    <button id="autosave"></button>
    <button id="tamper">corrupt slot_1 (test .bak)</button>
    <button id="reset">reset demo</button>
  </div>
  <div id="log"></div>
</main>
<script type="module">
  import { loadEasySave } from "./easysave-web.js";
  const es = await loadEasySave(".", { seed: true });
  const { saves, i18n } = es;
  let state = saves.load("slot_2").data ?? es.defaults();
  const log = (s) => { document.getElementById("log").textContent = s + "\\n" + document.getElementById("log").textContent; };
  const slotName = (s) => s.startsWith("slot_") ? i18n.t("save.slot", { n: s.slice(5) }) : s === "quick" ? i18n.t("save.quick") : i18n.t("save.auto", { n: Number(s.slice(5)) + 1 });
  function render() {
    document.documentElement.lang = i18n.locale;
    document.getElementById("title").textContent = i18n.t("save.load_title");
    document.getElementById("sub").textContent = ${JSON.stringify(b.schema.name?.th ?? b.schema.id)} + " · v" + saves.schema.version;
    document.getElementById("autosave").textContent = i18n.t("save.autosaving");
    document.getElementById("langs").innerHTML = ${JSON.stringify(b.locales)}.map((l) => \`<button data-lang="\${l}" class="\${l === i18n.locale ? "on" : ""}">\${i18n.t("lang." + l)}</button>\`).join("");
    const box = document.getElementById("slots");
    box.innerHTML = "";
    for (const s of saves.list()) {
      const row = document.createElement("div");
      row.className = "slot";
      row.dataset.slot = s.slot;
      const d = s.exists && s.ok ? saves.load(s.slot) : null;
      const info = !s.exists ? i18n.t("save.empty")
        : !s.ok ? \`<span class="bad">\${i18n.t("save.corrupt")}</span>\${s.hasBackup ? " · .bak" : ""}\`
        : \`\${i18n.t("save.day", { day: d.data.day })} · \${i18n.t("save.money", { money: d.data.player.money })}<small>\${d.meta.label ?? ""}\${d.migratedFrom ? " · " + i18n.t("save.migrated", { from: d.migratedFrom }) : ""}</small>\`;
      row.innerHTML = \`<b>\${slotName(s.slot)}</b><span>\${info}</span><span><button data-act="save">\${i18n.t("save.title")}</button> <button data-act="load" \${s.exists ? "" : "disabled"}>\${i18n.t("save.load_title")}</button></span>\`;
      box.appendChild(row);
    }
  }
  document.body.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.lang) { es.setLocale(t.dataset.lang); render(); return; }
    const slot = t.closest(".slot")?.dataset.slot;
    if (t.dataset.act === "save") {
      const r = saves.save(slot, state, { label: state.player.scene + " · " + i18n.t("save.day", { day: state.day }), playtime: state.stats.playtime, locale: i18n.locale });
      log(r.ok ? i18n.t("save.saved") + " → " + slot + " (" + r.slot.checksum + ")" : "save failed: " + JSON.stringify(r.diagnostics));
    } else if (t.dataset.act === "load") {
      const r = saves.load(slot);
      if (r.ok) state = r.data;
      log(r.ok ? i18n.t("save.loaded") + " ← " + slot + (r.usedBackup ? " · " + i18n.t("save.used_backup") : "") + (r.migratedFrom ? " · " + i18n.t("save.migrated", { from: r.migratedFrom }) : "") : "load failed: " + r.reason);
    } else if (t.id === "play") {
      state.player.money += 10; state.day += 1; state.stats.playtime += 600; state.stats.max_money = Math.max(state.stats.max_money, state.player.money);
      log("day " + state.day + " · " + state.player.money + " ฿");
    } else if (t.id === "autosave") {
      const r = es.autosave(state);
      log(r.ok ? i18n.t("save.autosaving") + " auto_0" : "autosave failed");
    } else if (t.id === "tamper") {
      const k = saves.key("slot_1");
      const raw = es.storage.get(k);
      if (raw) es.storage.set(k, raw.replace(/"money": \\d+/, '"money": 99999'));
      log("slot_1 edited by hand: checksum no longer matches");
    } else if (t.id === "reset") {
      es.reset().then(() => { state = saves.load("slot_2").data ?? es.defaults(); log("reset"); render(); });
      return;
    }
    render();
  });
  render();
  window.__save = { es, saves, i18n, get state() { return state; }, render };
  window.__ready = true;
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ Godot

const gstr = (s: string) => JSON.stringify(s);

function project(b: Bundle) {
  const tr = b.locales.map((l) => `"res://easysave/i18n/strings.${l}.translation"`).join(", ");
  return `; Engine configuration file — generated by Easy Save ${VERSION}
config_version=5

[application]

config/name=${gstr(`Easy Save demo · ${b.schema.id}`)}
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[autoload]

SaveManager="*res://easysave/save_manager.gd"
I18n="*res://easysave/i18n.gd"

[display]

window/size/viewport_width=640
window/size/viewport_height=360
window/size/window_width_override=1280
window/size/window_height_override=720
window/stretch/mode="canvas_items"

[gui]

theme/custom_font="res://easysave/fonts/Kanit-Regular.ttf"

[internationalization]

locale/translations=PackedStringArray(${tr})
locale/fallback="en"
locale/include_text_server_data=true

[rendering]

renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`;
}

const MAIN_TSCN = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]

[node name="Main" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_main")
`;

const MAIN_GD = `extends Control
## Easy Save demo: a load screen built from SaveManager.list() with labels from the string tables.
## User args (after --): --lang=th|en|ms  --shot=/path.png  --reset (re-copy the sample saves into user://saves)

const BG := Color("140e0a")
const PANEL := Color("2e2014")
const INK := Color("1a1008")
const GOLD := Color("f4ae3d")
const CREAM := Color("f7ebd3")
const MUTED := Color("b8a080")
const BAD := Color("e0604a")
var _box: VBoxContainer
var _title: Label


func _ready() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else true
	var dir := ProjectSettings.globalize_path(SaveManager.save_dir)
	if args.has("reset") or not DirAccess.dir_exists_absolute(dir) or DirAccess.get_files_at(dir).size() == 0:
		_seed()
	I18n.set_locale(str(args.get("lang", "th")))
	_build()
	_refresh()
	if args.has("shot"):
		await get_tree().process_frame
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(str(args["shot"]))
		print("shot ", args["shot"])
		get_tree().quit()


func _seed() -> void:
	DirAccess.make_dir_recursive_absolute(SaveManager.save_dir)
	for s in SaveManager.slots():
		SaveManager.remove(s)
	for f in DirAccess.get_files_at("res://easysave/fixtures"):
		if f.ends_with(".save.json") and not f.begins_with("tampered"):
			var text := FileAccess.get_file_as_string("res://easysave/fixtures/" + f)
			var fa := FileAccess.open(SaveManager.save_dir + "/" + f, FileAccess.WRITE)
			fa.store_string(text)
			fa.close()


func _label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _build() -> void:
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 24
	root.offset_top = 14
	root.offset_right = -24
	root.offset_bottom = -10
	root.add_theme_constant_override("separation", 6)
	add_child(root)
	var head := HBoxContainer.new()
	root.add_child(head)
	_title = _label("", 20, GOLD)
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	for loc in I18n.locales:
		var b := Button.new()
		b.text = tr("lang." + loc)
		b.add_theme_font_size_override("font_size", 11)
		b.pressed.connect(func():
			I18n.set_locale(loc)
			_refresh())
		head.add_child(b)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 4)
	root.add_child(_box)


func _slot_name(s: String) -> String:
	if s.begins_with("slot_"):
		return tr("save.slot").format({"n": s.substr(5)})
	if s == "quick":
		return tr("save.quick")
	return tr("save.auto").format({"n": int(s.substr(5)) + 1})


func _refresh() -> void:
	_title.text = tr("save.load_title")
	for c in _box.get_children():
		c.queue_free()
	for info in SaveManager.list():
		var row := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = PANEL
		sb.border_color = INK
		sb.set_border_width_all(2)
		sb.content_margin_left = 10
		sb.content_margin_right = 10
		sb.content_margin_top = 3
		sb.content_margin_bottom = 3
		row.add_theme_stylebox_override("panel", sb)
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 12)
		row.add_child(h)
		var name := _label(_slot_name(info["slot"]), 13, GOLD)
		name.custom_minimum_size.x = 130
		h.add_child(name)
		var text := tr("save.empty")
		var color := MUTED
		if info["exists"]:
			var r := SaveManager.load_slot(info["slot"])
			if r["ok"]:
				var d: Dictionary = r["data"]
				text = "%s · %s" % [tr("save.day").format({"day": d["day"]}), tr("save.money").format({"money": d["player"]["money"]})]
				var label := str(r["meta"].get("label", ""))
				if r.has("migrated_from"):
					label += "  ·  " + tr("save.migrated").format({"from": r["migrated_from"]})
				if r.get("used_backup", false):
					label += "  ·  " + tr("save.used_backup")
				text += "\\n" + label
				color = CREAM
			else:
				text = tr("save.corrupt")
				color = BAD
		h.add_child(_label(text, 11, color))
		_box.add_child(row)
`;

async function exportGodot(w: Writer, b: Bundle) {
  const { schema } = b;
  await w.write("project.godot", project(b));
  await w.write("icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3a2819"/><rect x="3" y="3" width="10" height="10" fill="#9fb4cc"/></svg>\n`);
  await w.write("easysave/schema.json", `${JSON.stringify(schema, null, 2)}\n`);
  await w.copy(path.join(RUNTIME_DIR, "godot", "save_manager.gd"), "easysave/save_manager.gd");
  await w.copy(path.join(RUNTIME_DIR, "godot", "i18n.gd"), "easysave/i18n.gd");
  const rt = runtimeStrings(b, true);
  // Godot CSV import: one column per locale, fallbacks filled so tr() never shows a raw key
  const filled = { ...b.docs[0]!, id: "runtime", strings: Object.fromEntries(Object.entries(rt.strings).map(([k, v]) => [k, v])) } as StringsDoc;
  await w.write("easysave/i18n/strings.csv", toCsv([filled], b.locales));
  await w.write("easysave/i18n/strings.json", `${JSON.stringify(rt, null, 2)}\n`);
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `easysave/fonts/${f}`);
  for (const s of b.saves) await w.write(`easysave/fixtures/${s.id}${SAVE_EXT}`, s.text);
  const first = b.saves.find((s) => readSlot(schema, JSON.parse(s.text)).ok);
  if (first) await w.write(`easysave/fixtures/tampered_${first.id}${SAVE_EXT}`, first.text.replace(/"playtime": (\d+)/, (_, n: string) => `"playtime": ${Number(n) + 1}`));
  await w.write("main.tscn", MAIN_TSCN);
  await w.write("main.gd", MAIN_GD);
  await w.write("test_save.gd", testGd(b));
  await w.write("README.txt", `Easy Save ${VERSION} · Godot 4.3+ export

  easysave/save_manager.gd   autoload SaveManager: save_slot / load_slot / autosave / list / remove, checksum, migrations
  easysave/i18n.gd           autoload I18n: set_locale, t(key, params); JSON fallback when the CSV is not imported
  easysave/schema.json       ${schema.id} v${schema.version} (slots: ${schema.slots.manual} manual${schema.slots.quick ? " + quick" : ""}${schema.slots.autosave ? ` + ${schema.slots.autosave.keep} autosave every ${schema.slots.autosave.intervalSec}s` : ""})
  easysave/i18n/strings.csv  keys,${b.locales.join(",")} → Godot imports strings.<locale>.translation (listed in project.godot)
  easysave/i18n/strings.json the same strings for the JSON fallback
  easysave/fixtures/         sample saves written by the CLI (the demo copies them to user://saves)
  main.tscn                  load screen demo (-- --lang=en --shot=out.png --reset)
  test_save.gd               godot --headless --path . --script res://test_save.gd   (prints OK)

Open the project once in the editor (or run godot --headless --editor --quit) so the CSV is imported.

${fontNotesText()}
`);
}

function testGd(b: Bundle): string {
  const { schema } = b;
  const fixture = '{"thai":"ข้าวเหนียว\\n\\"มะม่วง\\"\\t✓ ป่า ผู้","n":[0,-0.5,1.25,3,1e-7,0.1,123456.789012,2.5e-6,-1.0000005,1e15,0.30000000000000004],"nested":{"b":true,"a":null,"z":[{}],"ก":"x","A":"y","é":1},"ctrl":"\\u0001\\u001f","e":""}';
  const fx = JSON.parse(fixture);
  const migrated = b.saves.map((s) => {
    const raw = JSON.parse(s.text) as SlotFile;
    const r = readSlot(schema, raw);
    return { id: s.id, ok: r.ok, data: r.ok ? canon(r.data) : "", migratedFrom: r.migratedFrom ?? 0 };
  });
  const dflt = defaults(schema);
  const fixedMeta = { savedAt: "2026-01-01T00:00:00", playtime: 0 };
  const dfltSlot = makeSlot(schema, "slot_1", dflt, fixedMeta);
  const probes: Array<[string, Record<string, unknown>]> = [["save.title", {}], ["save.slot", { n: 2 }], ["save.money", { money: 25 }], ["lang.th", {}], ["lang.ms", {}]];
  const merged = mergeTables(b.docs);
  const salam = Object.keys(merged).find((k) => k.startsWith("dlg.salam_neighbours.") && !merged[k]!.en);
  if (salam) probes.push([salam, {}]);
  const trExpect: Record<string, Record<string, string>> = {};
  for (const loc of b.locales) trExpect[loc] = Object.fromEntries(probes.filter(([k]) => merged[k]).map(([k, p]) => [k, format(runtimeText(merged[k]!, loc, b.source), p)]));
  return `extends SceneTree
## Easy Save Godot check (generated). godot --headless --path . --script res://test_save.gd
## C| canonical JSON + checksum match the TypeScript core   V| fixture saves verify, tampered one fails
## M| migrations + normalisation give the same data as the CLI   S| save / .bak fallback / autosave rotation
## T| tr() per locale after the CSV import (or the JSON fallback)

const FIXTURE := ${gstr(fixture)}
const FIXTURE_CANON := ${gstr(canon(fx))}
const FIXTURE_SUM := ${gstr(checksumOf(fx))}
const MIGRATED := ${JSON.stringify(Object.fromEntries(migrated.map((m) => [m.id, { ok: m.ok, data: m.data, from: m.migratedFrom }])))}
const DEFAULT_SUM := ${gstr(dfltSlot.checksum)}
const DEFAULT_META := ${JSON.stringify(fixedMeta)}
const TR := ${JSON.stringify(trExpect)}
var failed := false
var frame := 0
var sm: Node
var i18n: Node


func fail(m: String) -> void:
	failed = true
	print("FAIL ", m)


func _initialize() -> void:
	sm = load("res://easysave/save_manager.gd").new()
	sm.load_schema("res://easysave/schema.json")
	sm.save_dir = "user://test_saves"
	sm.track_playtime = false
	root.add_child(sm)
	i18n = load("res://easysave/i18n.gd").new()
	root.add_child(i18n)


func _process(_delta: float) -> bool:
	frame += 1
	if frame < 2:
		return false
	_run()
	print("FAILED" if failed else "OK")
	return true


func _run() -> void:
	# C: canonical JSON and checksum
	var fx = JSON.parse_string(FIXTURE)
	if sm.canon(fx) != FIXTURE_CANON:
		fail("canon\\n  godot %s\\n  ts    %s" % [sm.canon(fx), FIXTURE_CANON])
	elif sm.checksum_of(fx) != FIXTURE_SUM:
		fail("checksum %s != %s" % [sm.checksum_of(fx), FIXTURE_SUM])
	else:
		print("C| canon ok checksum=%s" % FIXTURE_SUM)
	# V + M: fixtures
	var n_ok := 0
	for id in MIGRATED:
		var text := FileAccess.get_file_as_string("res://easysave/fixtures/%s.save.json" % id)
		var r: Dictionary = sm.parse_slot(text)
		var want: Dictionary = MIGRATED[id]
		if r["ok"] != want["ok"]:
			fail("%s ok=%s want %s (%s)" % [id, r["ok"], want["ok"], r.get("reason", "")])
			continue
		if r["ok"] and sm.canon(r["data"]) != want["data"]:
			fail("%s data\\n  godot %s\\n  ts    %s" % [id, sm.canon(r["data"]), want["data"]])
			continue
		if int(r.get("migrated_from", 0)) != int(want["from"]):
			fail("%s migrated_from %s != %s" % [id, r.get("migrated_from", 0), want["from"]])
			continue
		n_ok += 1
	var tampered: Array[String] = []
	for f in DirAccess.get_files_at("res://easysave/fixtures"):
		if f.begins_with("tampered_"):
			tampered.append(f)
	for f in tampered:
		var r: Dictionary = sm.parse_slot(FileAccess.get_file_as_string("res://easysave/fixtures/" + f))
		if r["ok"] or r["reason"] != "checksum":
			fail("%s should fail its checksum, got %s" % [f, r])
	print("V| fixtures=%d tampered=%d" % [n_ok, tampered.size()])
	print("M| migrated ok")
	# S: write, read back, backup fallback, autosave rotation
	for s in sm.slots():
		sm.remove(s)
	var d: Dictionary = sm.defaults()
	var body := {"game": sm.schema["id"], "version": int(sm.schema["version"]), "meta": DEFAULT_META, "data": sm.normalize(d)["data"]}
	if sm.checksum_of(body) != DEFAULT_SUM:
		fail("default slot checksum %s != %s" % [sm.checksum_of(body), DEFAULT_SUM])
	var w: Dictionary = sm.save_slot("slot_1", d, {"label": "godot"})
	d["player"]["money"] = 42
	sm.save_slot("slot_1", d, {"label": "godot 2"})
	var back: Dictionary = sm.load_slot("slot_1")
	if not back["ok"] or int(back["data"]["player"]["money"]) != 42:
		fail("load after save: %s" % back)
	var p: String = sm.path_of("slot_1")
	var fa := FileAccess.open(p, FileAccess.WRITE)
	fa.store_string("{ broken")
	fa.close()
	var fb: Dictionary = sm.load_slot("slot_1")
	if not fb["ok"] or not fb.get("used_backup", false) or int(fb["data"]["player"]["money"]) != 0:
		fail("backup fallback: %s" % fb)
	var bad: Dictionary = sm.save_slot("slot_2", {"player": {"money": -5}})
	if bad["ok"]:
		fail("money -5 should be rejected (min 0)")
	for i in 3:
		d["day"] = i + 1
		sm.autosave(d)
	var a0: Dictionary = sm.load_slot("auto_0")
	var a1: Dictionary = sm.load_slot("auto_1")
	if not a0["ok"] or not a1["ok"] or int(a0["data"]["day"]) != 3 or int(a1["data"]["day"]) != 2:
		fail("autosave rotation: auto_0 %s auto_1 %s" % [a0.get("data", {}).get("day"), a1.get("data", {}).get("day")])
	sm.save_slot("slot_3", d, {"label": "from godot"})
	print("W| %s" % ProjectSettings.globalize_path(sm.path_of("slot_3")))
	print("S| save ok backup ok autosave ok")
	# T: translations
	var n := 0
	for loc in TR:
		TranslationServer.set_locale(loc)
		for key in TR[loc]:
			var want := str(TR[loc][key])
			var got := tr(key)
			var params := {"n": 2, "money": 25}
			if got.contains("{"):
				got = got.format(params)
			if got != want:
				fail("tr %s [%s] = %s, want %s" % [key, loc, got, want])
			n += 1
	var imported := ResourceLoader.exists("res://easysave/i18n/strings.th.translation")
	print("T| tr ok checks=%d imported=%s json_fallback=%s" % [n, imported, i18n.used_json_fallback])
`;
}

export { THAI_FONTS, checksumBody };
