extends Node
## Easy Save · SaveManager autoload (Godot 4.3+). Add as autoload "SaveManager".
##
## Versioned save slots for one easysave/1 schema (res://easysave/schema.json): schema defaults, declarative
## migrations, an FNV-1a checksum over canonical JSON (identical to the CLI and the web runtime), a .bak copy of the
## previous file, and rotating autosaves.
##
##   SaveManager.save_slot("slot_1", data, {"label": "ตลาดเช้า"})  # -> {ok, slot, diagnostics} or {ok: false, reason}
##   var r := SaveManager.load_slot("slot_1")                       # -> {ok, data, meta, migrated_from, used_backup}
##   SaveManager.start_autosave(func(): return game_state())   # every schema.slots.autosave.intervalSec
##   SaveManager.list()                                         # slot summaries for a load screen

signal saved(slot: String, file: Dictionary)
signal loaded(slot: String, result: Dictionary)
signal autosaved(file: Dictionary)

const SLOT_FORMAT := "easysave-slot/1"
const SCHEMA_PATH := "res://easysave/schema.json"
const MAX_SAFE := 9007199254740992.0

@export var save_dir := "user://saves"
var schema: Dictionary = {}
## Seconds played since start (written to meta.playtime by save_slot()).
var playtime := 0.0
var track_playtime := true
var _autosave_timer: Timer
var _provider: Callable


func _ready() -> void:
	if schema.is_empty() and FileAccess.file_exists(SCHEMA_PATH):
		load_schema(SCHEMA_PATH)


func _process(delta: float) -> void:
	if track_playtime:
		playtime += delta


func load_schema(path: String) -> void:
	schema = JSON.parse_string(FileAccess.get_file_as_string(path))


# ------------------------------------------------------------------ canonical JSON + checksum

func canon_number(n: float) -> String:
	if is_nan(n) or is_inf(n):
		return "null"
	if floor(n) == n and absf(n) < MAX_SAFE:
		return "0" if n == 0.0 else str(int(n))
	var q := floori(n * 1e6 + 0.5)
	if q == 0:
		return "0"
	var neg := q < 0
	var a := absi(q)
	var ip := a / 1000000
	var frac := str(a - ip * 1000000).pad_zeros(6)
	while frac.ends_with("0"):
		frac = frac.substr(0, frac.length() - 1)
	return ("-" if neg else "") + str(ip) + ("." + frac if frac != "" else "")


func canon_string(s: String) -> String:
	var out := "\""
	for i in s.length():
		var c := s.unicode_at(i)
		var ch := s[i]
		if ch == "\"":
			out += "\\\""
		elif ch == "\\":
			out += "\\\\"
		elif c == 10:
			out += "\\n"
		elif c == 13:
			out += "\\r"
		elif c == 9:
			out += "\\t"
		elif c == 8:
			out += "\\b"
		elif c == 12:
			out += "\\f"
		elif c < 32:
			out += "\\u%04x" % c
		else:
			out += ch
	return out + "\""


func canon(v) -> String:
	match typeof(v):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_INT:
			return str(v)
		TYPE_FLOAT:
			return canon_number(v)
		TYPE_STRING, TYPE_STRING_NAME:
			return canon_string(str(v))
		TYPE_ARRAY:
			var parts := PackedStringArray()
			for x in v:
				parts.append(canon(x))
			return "[" + ",".join(parts) + "]"
		TYPE_DICTIONARY:
			var keys: Array = v.keys()
			keys.sort()
			var parts := PackedStringArray()
			for k in keys:
				parts.append(canon_string(str(k)) + ":" + canon(v[k]))
			return "{" + ",".join(parts) + "}"
	return canon_string(str(v))


func fnv1a32(s: String) -> String:
	var h := 0x811c9dc5
	for b in s.to_utf8_buffer():
		h = ((h ^ b) * 16777619) & 0xFFFFFFFF
	return "%08x" % h


func checksum_of(v) -> String:
	return fnv1a32(canon(v))


func checksum_body(f: Dictionary) -> Dictionary:
	return {"game": f.get("game"), "version": f.get("version"), "meta": f.get("meta"), "data": f.get("data")}


# ------------------------------------------------------------------ defaults / normalise

func default_of(f: Dictionary):
	if f.has("default"):
		return _clone(f["default"])
	match str(f["type"]):
		"int", "float", "scalar":
			return f["min"] if f.has("min") and float(f["min"]) > 0 else 0
		"bool":
			return false
		"string":
			return ""
		"enum":
			return f["values"][0] if f.get("values", []).size() > 0 else ""
		"list":
			return []
		"map":
			return {}
		"object":
			var o := {}
			for k in f.get("fields", {}):
				o[k] = default_of(f["fields"][k])
			return o
	return null


func defaults() -> Dictionary:
	return default_of({"type": "object", "fields": schema["fields"]})


func _clone(v):
	if v is Dictionary or v is Array:
		return v.duplicate(true)
	return v


func _is_num(v) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT


func _join(p: String, k) -> String:
	return str(k) if p == "" else p + "." + str(k)


func _diag(diags: Array, path: String, msg: String, sev: String) -> void:
	diags.append({"path": path, "message": msg, "severity": sev})


func normalize_value(f: Dictionary, v, p: String, diags: Array):
	var t := str(f["type"])
	match t:
		"int":
			if not _is_num(v) or floor(float(v)) != float(v):
				_diag(diags, p, "expected an integer, got " + canon(v), "error")
				return v
			var n := int(v)
			_range(f, n, p, diags)
			return n
		"float":
			if not _is_num(v):
				_diag(diags, p, "expected a number, got " + canon(v), "error")
				return v
			_range(f, float(v), p, diags)
			return v
		"bool":
			if typeof(v) != TYPE_BOOL:
				_diag(diags, p, "expected true or false, got " + canon(v), "error")
			return v
		"string":
			if typeof(v) != TYPE_STRING:
				_diag(diags, p, "expected text, got " + canon(v), "error")
			elif f.has("maxLength") and v.length() > int(f["maxLength"]):
				_diag(diags, p, "longer than %d characters" % int(f["maxLength"]), "error")
			return v
		"enum":
			var found := false
			for x in f.get("values", []):
				if typeof(x) == typeof(v) and x == v or _is_num(x) and _is_num(v) and float(x) == float(v):
					found = true
			if not found:
				_diag(diags, p, canon(v) + " is not one of the enum values", "error")
			return v
		"scalar":
			if not (_is_num(v) or typeof(v) == TYPE_STRING or typeof(v) == TYPE_BOOL):
				_diag(diags, p, "expected a number, text or true/false, got " + canon(v), "error")
			return v
		"any":
			return v
		"list":
			if typeof(v) != TYPE_ARRAY:
				_diag(diags, p, "expected a list, got " + canon(v), "error")
				return v
			if f.has("max") and v.size() > int(f["max"]):
				_diag(diags, p, "more than %d entries" % int(f["max"]), "error")
			var out := []
			for i in v.size():
				out.append(normalize_value(f["of"], v[i], "%s[%d]" % [p, i], diags))
			return out
		"map":
			if typeof(v) != TYPE_DICTIONARY:
				_diag(diags, p, "expected an object (map), got " + canon(v), "error")
				return v
			var m := {}
			for k in v:
				m[k] = normalize_value(f["of"], v[k], _join(p, k), diags)
			return m
		"object":
			if typeof(v) != TYPE_DICTIONARY:
				_diag(diags, p, "expected an object, got " + canon(v), "error")
				return v
			var o := {}
			var fields: Dictionary = f.get("fields", {})
			for k in fields:
				if not v.has(k):
					o[k] = default_of(fields[k])
					_diag(diags, _join(p, k), "missing, filled with the default", "info")
				else:
					o[k] = normalize_value(fields[k], v[k], _join(p, k), diags)
			for k in v:
				if not fields.has(k):
					_diag(diags, _join(p, k), "unknown field (dropped)", "warning")
			return o
	return v


func _range(f: Dictionary, n: float, p: String, diags: Array) -> void:
	if f.has("min") and n < float(f["min"]):
		_diag(diags, p, "%s is below min %s" % [canon(n), canon(f["min"])], "error")
	if f.has("max") and n > float(f["max"]):
		_diag(diags, p, "%s is above max %s" % [canon(n), canon(f["max"])], "error")


func normalize(data) -> Dictionary:
	var diags := []
	var out = normalize_value({"type": "object", "fields": schema["fields"]}, data, "", diags)
	return {"data": out, "diagnostics": diags}


func _has_errors(diags: Array) -> bool:
	for d in diags:
		if d["severity"] == "error":
			return true
	return false


# ------------------------------------------------------------------ migrations

func _expand(root, path: String) -> Array:
	var cur := [{"node": root, "parts": [], "binds": []}]
	for s in path.split("."):
		var next := []
		for c in cur:
			var node = c["node"]
			if s == "*":
				var keys := []
				if node is Array:
					for j in node.size():
						keys.append(str(j))
				elif node is Dictionary:
					keys = node.keys()
				for k in keys:
					var child = node[int(k)] if node is Array else node[k]
					next.append({"node": child, "parts": c["parts"] + [str(k)], "binds": c["binds"] + [str(k)]})
			else:
				var child = null
				if node is Dictionary:
					child = node.get(s, null)
				elif node is Array and s.is_valid_int() and int(s) < node.size():
					child = node[int(s)]
				next.append({"node": child, "parts": c["parts"] + [s], "binds": c["binds"]})
		cur = next
	return cur


func _get_at(root, parts: Array):
	var n = root
	for p in parts:
		if n is Dictionary:
			if not n.has(p):
				return null
			n = n[p]
		elif n is Array and str(p).is_valid_int() and int(p) < n.size():
			n = n[int(p)]
		else:
			return null
	return n


func _has_at(root, parts: Array) -> bool:
	var parent = _get_at(root, parts.slice(0, parts.size() - 1))
	var k = parts[parts.size() - 1]
	if parent is Dictionary:
		return parent.has(k)
	if parent is Array:
		return str(k).is_valid_int() and int(k) < parent.size()
	return false


func _set_at(root: Dictionary, parts: Array, v) -> void:
	var n = root
	for i in parts.size() - 1:
		var p = parts[i]
		var nxt = n[int(p)] if n is Array else n.get(p, null)
		if not (nxt is Dictionary or nxt is Array):
			nxt = {}
			if n is Array:
				n[int(p)] = nxt
			else:
				n[p] = nxt
		n = nxt
	var last = parts[parts.size() - 1]
	if n is Array:
		n[int(last)] = v
	else:
		n[last] = v


func _delete_at(root, parts: Array) -> void:
	var parent = _get_at(root, parts.slice(0, parts.size() - 1))
	var k = parts[parts.size() - 1]
	if parent is Array:
		parent.remove_at(int(k))
	elif parent is Dictionary:
		parent.erase(k)


func _bind(pattern: String, binds: Array) -> Array:
	var out := []
	var i := 0
	for s in pattern.split("."):
		if s == "*":
			out.append(binds[i])
			i += 1
		else:
			out.append(s)
	return out


func apply_op(data: Dictionary, o: Dictionary) -> int:
	var n := 0
	match str(o["op"]):
		"rename", "copy":
			for e in _expand(data, o["from"]):
				if not _has_at(data, e["parts"]):
					continue
				var v = _clone(_get_at(data, e["parts"]))
				if o["op"] == "rename":
					_delete_at(data, e["parts"])
				_set_at(data, _bind(o["to"], e["binds"]), v)
				n += 1
		"add", "set":
			for e in _expand(data, o["path"]):
				if o["op"] == "add" and _has_at(data, e["parts"]):
					continue
				_set_at(data, e["parts"], _clone(o["value"]))
				n += 1
		"delete":
			var list := _expand(data, o["path"])
			list.reverse()
			for e in list:
				if _has_at(data, e["parts"]):
					_delete_at(data, e["parts"])
					n += 1
		"map":
			for e in _expand(data, o["path"]):
				if not _has_at(data, e["parts"]):
					continue
				var cur = _get_at(data, e["parts"])
				var key: String = cur if typeof(cur) == TYPE_STRING else canon(cur)
				if o["values"].has(key):
					_set_at(data, e["parts"], _clone(o["values"][key]))
					n += 1
		"wrap":
			for e in _expand(data, o["path"]):
				if not _has_at(data, e["parts"]):
					continue
				var cur = _get_at(data, e["parts"])
				if cur is Array:
					continue
				_set_at(data, e["parts"], [] if cur == null or (typeof(cur) == TYPE_STRING and cur == "") else [cur])
				n += 1
	return n


func migrate(data: Dictionary, from_version: int) -> Dictionary:
	var out: Dictionary = data.duplicate(true)
	var v := from_version
	var target := int(schema["version"])
	if v > target:
		return {"ok": false, "data": out, "version": v, "error": "save is v%d, newer than the game's v%d" % [v, target]}
	while v < target:
		var m = null
		for x in schema.get("migrations", []):
			if int(x["from"]) == v:
				m = x
		if m == null:
			return {"ok": false, "data": out, "version": v, "error": "no migration from v%d" % v}
		for o in m["ops"]:
			apply_op(out, o)
		v = int(m["to"])
	return {"ok": true, "data": out, "version": v}


# ------------------------------------------------------------------ slots

func slots() -> Array:
	var r: Dictionary = schema["slots"]
	var out := []
	for i in int(r.get("manual", 0)):
		out.append("slot_%d" % (i + 1))
	if r.get("quick", false):
		out.append("quick")
	if r.has("autosave"):
		for i in int(r["autosave"]["keep"]):
			out.append("auto_%d" % i)
	return out


func path_of(slot: String) -> String:
	return "%s/%s.save.json" % [save_dir, slot]


func make_slot(slot: String, data: Dictionary, meta: Dictionary) -> Dictionary:
	var m := {"savedAt": Time.get_datetime_string_from_system(), "playtime": int(playtime)}
	m.merge(meta, true)
	var f := {"format": SLOT_FORMAT, "game": schema["id"], "version": int(schema["version"]), "slot": slot, "meta": m, "data": data}
	f["checksum"] = checksum_of(checksum_body(f))
	return f


func verify(f) -> Dictionary:
	if not (f is Dictionary) or f.get("format", "") != SLOT_FORMAT or not (f.get("data") is Dictionary) or not (f.get("meta") is Dictionary):
		return {"ok": false, "reason": "not_a_save"}
	var actual := checksum_of(checksum_body(f))
	if actual != str(f.get("checksum", "")):
		return {"ok": false, "reason": "checksum", "expected": str(f.get("checksum", "")), "actual": actual}
	return {"ok": true, "actual": actual}


## Verify, migrate and normalise a parsed slot file (the same steps as the CLI's readSlot).
func read_slot(f) -> Dictionary:
	var v := verify(f)
	if not v["ok"]:
		return {"ok": false, "reason": v["reason"], "diagnostics": []}
	if str(f["game"]) != str(schema["id"]):
		return {"ok": false, "reason": "wrong_game", "diagnostics": []}
	var ver := int(f["version"])
	if ver > int(schema["version"]):
		return {"ok": false, "reason": "too_new", "diagnostics": []}
	var m := migrate(f["data"], ver)
	if not m["ok"]:
		return {"ok": false, "reason": "migration", "message": m["error"], "diagnostics": []}
	var n := normalize(m["data"])
	if _has_errors(n["diagnostics"]):
		return {"ok": false, "reason": "invalid", "diagnostics": n["diagnostics"]}
	var r := {"ok": true, "slot": f["slot"], "data": n["data"], "meta": f["meta"], "diagnostics": n["diagnostics"]}
	if ver < int(schema["version"]):
		r["migrated_from"] = ver
	return r


func parse_slot(text) -> Dictionary:
	if text == null:
		return {"ok": false, "reason": "empty", "diagnostics": []}
	var j := JSON.new()
	if j.parse(text) != OK:
		return {"ok": false, "reason": "parse", "message": j.get_error_message(), "diagnostics": []}
	return read_slot(j.data)


func _read(path: String):
	if not FileAccess.file_exists(path):
		return null
	return FileAccess.get_file_as_string(path)


func _write(path: String, text: String) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var tmp := path + ".tmp"
	var fa := FileAccess.open(tmp, FileAccess.WRITE)
	fa.store_string(text)
	fa.close()
	DirAccess.rename_absolute(tmp, path)


func save_slot(slot: String, data, meta: Dictionary = {}) -> Dictionary:
	if not slots().has(slot):
		return {"ok": false, "reason": "bad_slot", "diagnostics": []}
	var n := normalize(data)
	if _has_errors(n["diagnostics"]):
		return {"ok": false, "reason": "invalid", "diagnostics": n["diagnostics"]}
	var f := make_slot(slot, n["data"], meta)
	var path := path_of(slot)
	var prev = _read(path)
	if prev != null:
		_write(path + ".bak", prev)
	_write(path, JSON.stringify(f, "  ", true, true) + "\n")
	saved.emit(slot, f)
	return {"ok": true, "slot": f, "diagnostics": n["diagnostics"]}


func load_slot(slot: String) -> Dictionary:
	var path := path_of(slot)
	var main := parse_slot(_read(path))
	if main["ok"] or main["reason"] == "empty" and _read(path + ".bak") == null:
		loaded.emit(slot, main)
		return main
	var bak := parse_slot(_read(path + ".bak"))
	if bak["ok"]:
		bak["used_backup"] = true
		bak["message"] = "main file: " + str(main["reason"])
		loaded.emit(slot, bak)
		return bak
	loaded.emit(slot, main)
	return main


func autosave(data, meta: Dictionary = {}) -> Dictionary:
	var keep := int(schema["slots"].get("autosave", {}).get("keep", 0))
	if keep == 0:
		return {"ok": false, "reason": "bad_slot", "diagnostics": []}
	var n := normalize(data)
	if _has_errors(n["diagnostics"]):
		return {"ok": false, "reason": "invalid", "diagnostics": n["diagnostics"]}
	for i in range(keep - 1, 0, -1):
		var from = _read(path_of("auto_%d" % (i - 1)))
		if from != null:
			_write(path_of("auto_%d" % i), from)
	var r := save_slot("auto_0", n["data"], meta)
	if r["ok"]:
		autosaved.emit(r["slot"])
	return r


func remove(slot: String) -> void:
	for p in [path_of(slot), path_of(slot) + ".bak"]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)


## Slot summaries for a load screen: {slot, exists, ok, reason, version, meta, has_backup}.
func list() -> Array:
	var out := []
	for s in slots():
		var text = _read(path_of(s))
		var info := {"slot": s, "exists": text != null, "has_backup": FileAccess.file_exists(path_of(s) + ".bak")}
		if text != null:
			var r := parse_slot(text)
			info["ok"] = r["ok"]
			if not r["ok"]:
				info["reason"] = r["reason"]
			var parsed = JSON.parse_string(text)
			if parsed is Dictionary:
				info["version"] = int(parsed.get("version", 0))
				info["meta"] = parsed.get("meta", {})
		out.append(info)
	return out


## Call provider (returns the game data Dictionary) every autosave.intervalSec seconds.
func start_autosave(provider: Callable, meta_provider := Callable()) -> void:
	_provider = provider
	if _autosave_timer == null:
		_autosave_timer = Timer.new()
		add_child(_autosave_timer)
		_autosave_timer.timeout.connect(func():
			var meta: Dictionary = meta_provider.call() if meta_provider.is_valid() else {}
			autosave(_provider.call(), meta))
	_autosave_timer.wait_time = float(schema["slots"].get("autosave", {}).get("intervalSec", 120))
	_autosave_timer.start()


func stop_autosave() -> void:
	if _autosave_timer:
		_autosave_timer.stop()
