# Easy Save formats

Three JSON formats. Ids match `^[a-z0-9_-]+$`; field names match `^[a-z_][a-z0-9_]*$`.

## Schema: `schemas/<id>.easysave.json` (`easysave/1`)

```jsonc
{
  "format": "easysave/1",
  "id": "village_delivery",             // written into every save as "game"
  "name": { "th": "ต้นส่งของรอบหมู่บ้าน", "en": "Ton's village deliveries", "ms": "…" },
  "version": 3,                          // bump whenever saved data changes shape
  "slots": { "manual": 3, "quick": true, "autosave": { "intervalSec": 120, "keep": 2 } },
  "fields": { "<name>": Field, … },
  "migrations": [ { "from": 1, "to": 2, "note": "…", "ops": [ Op, … ] }, … ]
}
```

Slots: `slot_1` … `slot_<manual>` (0..99), `quick` when `quick` is true, `auto_0` … `auto_<keep-1>` (keep 1..9,
interval ≥ 5 s). `auto_0` is always the newest autosave.

### Field

| Key | |
|---|---|
| `type` | `int`, `float`, `bool`, `string`, `enum`, `list`, `map`, `object`, `scalar` (any of int / float / bool / string), `any` |
| `default` | value for a fresh save and for missing fields (`object` defaults come from its fields; `list` → `[]`, `map` → `{}`) |
| `min`, `max` | numbers: range. `list` / `map`: item count |
| `maxLength` | strings: maximum code points |
| `values` | `enum`: allowed values |
| `of` | `list` / `map`: element Field |
| `fields` | `object`: nested Fields |
| `desc` | free text for people and agents |

### Migration ops

Paths are dotted (`player.pos.x`); `*` matches every list index or map key, and `rename` / `copy` targets reuse
the matched keys in order (`deliveries.*.customer` → `deliveries.*.to`).

| Op | Keys | Effect |
|---|---|---|
| `rename` | `from`, `to` | move a value (creates missing parents) |
| `copy` | `from`, `to` | copy a value |
| `add` | `path`, `value` | set only when missing |
| `set` | `path`, `value` | always set |
| `delete` | `path` | remove |
| `map` | `path`, `values` | replace by lookup; keys are the old value as text (`"yes"`, `"true"`, `"3"`) |
| `wrap` | `path` | turn a single value into a one-item list (`null` / `""` → `[]`) |

Migrations must be consecutive (`to = from + 1`), cover every version from the oldest up to `version`, and never
point past it. After migrating, data is **normalised** against the fields: integral floats become ints, missing
fields get defaults (info), unknown fields are dropped (warning), wrong types and out-of-range values are errors
and the save is refused.

## Save slot: `saves/<slot>.save.json` (`easysave-slot/1`)

```jsonc
{
  "format": "easysave-slot/1",
  "game": "village_delivery",
  "version": 3,
  "slot": "slot_2",
  "meta": { "savedAt": "2026-11-15T19:40:00+07:00", "playtime": 5400, "label": "บ้านตาเพิ่ม · วันที่ 2", "locale": "th" },
  "data": { … },
  "checksum": "1a2b3c4d"
}
```

**Checksum** = FNV-1a 32 (lower-case hex) of the UTF-8 bytes of the canonical JSON of
`{ game, version, meta, data }`:

- object keys sorted by Unicode code point, no whitespace;
- integral numbers with |n| < 2^53 printed as integers (`3`, not `3.0`); other numbers as
  `floor(n × 10^6 + 0.5) / 10^6` with trailing zeros removed (`0.8`, `0.333333`);
- strings escaped like `JSON.stringify` (`\"`, `\\`, `\n`, `\t`, `\uXXXX` below U+0020; everything else literal).

Godot parses every JSON number as a float; this rule makes TypeScript and GDScript agree byte for byte. The slot
name is left out so a file can be copied or rotated to another slot. The checksum detects corruption and casual
edits; it is not tamper-proof.

**Loading**: parse → `not_a_save` / `wrong_game` / `checksum` / `too_new` → migrate (`migration`) → normalise
(`invalid`). A failure on the main file retries `<slot>.save.json.bak` (the previous good save; every save keeps
one). Results: `{ ok, data, meta, migratedFrom?, usedBackup?, reason?, message?, diagnostics }`.

## String table: `strings/<table>.easyi18n.json` (`easyi18n/1`)

```jsonc
{
  "format": "easyi18n/1",
  "id": "save_ui",
  "source": "th",
  "locales": ["th", "en", "ms"],
  "strings": {
    "save.slot":     { "th": "ช่องที่ {n}", "en": "Slot {n}", "ms": "Slot {n}", "note": "manual slot name" },
    "save.migrated": { "th": "อัปเดตเซฟจากเวอร์ชัน {from} แล้ว", "en": "…", "stale": ["ms"] },
    "lang.th":       { "th": "ไทย", "fixed": true }
  }
}
```

| Key | |
|---|---|
| `th` / `en` / `ms` | text; `{name}` placeholders must be the same set as the source |
| `note` | context for translators (PO `#.` comments; stale locales are marked `#, fuzzy`) |
| `src` | source file the key was extracted from |
| `stale` | locales translated before the source text changed (set by `extract`, cleared when a translation is saved) |
| `max` | maximum code points for UI text |
| `fixed` | same text in every locale (language names, logos): only the source is stored |

Keys are unique across all tables. `check` reports: duplicates, placeholder mismatches (error), missing
translations (warning; error with `--strict`), Thai script in en/ms (the ฿ sign is allowed), leading or trailing
spaces, `max` overruns and stale entries.

### Extracted keys

| Source | Keys |
|---|---|
| Easy Dialogue `.ezd` / `.dialogue.json` | `dlg.<doc>.<line id>` (explicit `#line:id`, else `node_N` / `node_cN` counted per node like the compiler), `dlg.<doc>.title`, `dlg.<doc>.char.<id>` |
| Easy Quest `.ezq` | `quest.<file>.file_title`, `quest.<quest>.title`, `.summary`, `.step.<step>`, `.step.<step>.hint`, `quest.flag.<id>`, `quest.item.<id>.name` / `.desc` |
| Easy UI `.easyui.json` | `ui.<doc>.<screen>.<widget>` plus `.title`, `.label`, `.<i>` (list items), `.tabs.<i>` |
| Easy Items `.easyitems.json` | `item.<id>.name` / `.desc`, `shop.<id>.name`, `recipe.<id>.name` (their en / ms names fill empty translations) |

### Runtime

Lookup order: current locale → `en` → `th` → the key itself (visible on screen). The Godot export writes a CSV with
every cell filled by that fallback so `tr()` behaves the same; translator exports (`strings.csv`, `*.po`) leave
blanks. PO: `msgctxt` = key, `msgid` = Thai source, `msgstr` = translation; importing a PO whose `msgid` no longer
matches the source marks the entry stale.
