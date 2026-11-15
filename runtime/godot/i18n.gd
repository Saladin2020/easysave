extends Node
## Easy Save · I18n autoload (Godot 4.3+). Add as autoload "I18n".
##
## Translations come from res://easysave/i18n/strings.csv, which Godot imports into strings.<locale>.translation files
## listed in Project Settings → Localization. When those files are missing (CSV not imported yet, or a project that
## skips the importer) this node builds Translation objects from res://easysave/i18n/strings.json at startup, so
## tr() works either way.
##
##   I18n.set_locale("ms")
##   label.text = tr("save.slot").format({"n": 1})      # or I18n.t("save.slot", {"n": 1})

signal locale_changed(locale: String)

const STRINGS_JSON := "res://easysave/i18n/strings.json"
const CSV_BASE := "res://easysave/i18n/strings"
var locales: PackedStringArray = []
var source_locale := "th"
## true when a locale's imported .translation was missing and the JSON fallback was used.
var used_json_fallback := {}


func _ready() -> void:
	if not FileAccess.file_exists(STRINGS_JSON):
		return
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(STRINGS_JSON))
	locales = PackedStringArray(data.get("locales", ["th", "en", "ms"]))
	source_locale = str(data.get("source", "th"))
	var strings: Dictionary = data.get("strings", {})
	for loc in locales:
		if ResourceLoader.exists("%s.%s.translation" % [CSV_BASE, loc]):
			used_json_fallback[loc] = false
			continue
		var t := Translation.new()
		t.locale = loc
		for key in strings:
			var v = strings[key].get(loc, "")
			if v != "":
				t.add_message(key, v)
		TranslationServer.add_translation(t)
		used_json_fallback[loc] = true


func set_locale(loc: String) -> void:
	TranslationServer.set_locale(loc)
	locale_changed.emit(loc)


func get_locale() -> String:
	return TranslationServer.get_locale()


## tr() plus {name} placeholders (String.format).
func t(key: String, params: Dictionary = {}) -> String:
	var s := tr(key)
	return s.format(params) if params.size() > 0 else s
