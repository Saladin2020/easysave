# Easy Save — studio usage guide

Save slots and translations for 2D games. Agents **write an `easysave/1` schema (with migrations), check saves,
extract every player-facing string into `easyi18n/1` tables, translate Thai → English / Malay and export** a Godot
4.3+ setup (`SaveManager` + `I18n` autoloads, TranslationServer CSV, Kanit) or a web / PixiJS runtime.

Install is local only. Do not push or modify the upstream GitHub repo.

## Paths

| What | Path |
|---|---|
| Install (package 0.1.0, `<SHA>` on master) | `/workspace/indie-studio/tools/easysave` |
| CLI wrapper | `node /workspace/indie-studio/tools/easysave-cli.mjs` |
| Studio projects | `/workspace/indie-studio/projects/<Name>/` |
| Format | `/workspace/indie-studio/tools/easysave/docs/FORMAT.md` |

A game's workspace holds `schemas/`, `saves/` (fixtures and test saves), `strings/`, `sources/` (or point
`sources` in `easysave.config.json` at the project's dialogue / quest / UI / item folders) and `exports/`.

```bash
export EASYSAVE_HOME=/workspace/indie-studio/tools/easysave
export EASYSAVE_WORKSPACE=/workspace/indie-studio/tools/easysave
export EASYSAVE_ALLOWED_DIRS=/workspace/indie-studio/projects
```

The wrapper sets these.

## Commands

```bash
W=--workspace=/workspace/indie-studio/projects/<Name>
node …/easysave-cli.mjs init $W                       # sample schema, saves, strings, sources
node …/easysave-cli.mjs schema $W                     # field tree + migrations
node …/easysave-cli.mjs check $W [--strict]           # exit 1 on errors
node …/easysave-cli.mjs verify saves/slot_1.save.json $W
node …/easysave-cli.mjs migrate old.save.json --out new.save.json $W
node …/easysave-cli.mjs slots $W
node …/easysave-cli.mjs extract $W [--dry-run] [--prune]
node …/easysave-cli.mjs strings --missing --locale ms $W
node …/easysave-cli.mjs strings-export --format csv|po $W ; node …/easysave-cli.mjs strings-import file.po $W
node …/easysave-cli.mjs export --preset godot|web|strings|all $W
node …/easysave-cli.mjs serve $W                      # http://127.0.0.1:8898
```

`export --out DIR` (single preset only) **writes into DIR without deleting it**.

## MCP

`node /workspace/indie-studio/tools/easysave/dist/mcp/server.js --workspace <dir>` (stdio) or add `--http --port 8899`.
Tools: `workspace_info`, `get_schema`, `write_schema` (`dryRun`), `list_slots`, `validate_save`, `migrate_save`,
`list_strings`, `set_strings`, `extract_strings`, `check_all`, `export_save`. Details: `docs/MCP.md` in the install.

## Godot import

Export `--preset godot`, copy `easysave/` into the game, add autoloads **`SaveManager`** (`res://easysave/save_manager.gd`)
and **`I18n`** (`res://easysave/i18n.gd`), add `easysave/i18n/strings.*.translation` to Project Settings →
Localization (the exported `project.godot` shows all of it, plus Kanit as the default font).
`SaveManager.save_slot(slot, data, meta)`, `load_slot(slot)` → `{ok, data, migrated_from, used_backup, reason}`,
`autosave`, `start_autosave(callable)`, `list()`, signals `saved`, `loaded`, `autosaved`. `I18n.t(key, params)` or `tr(key)`.
`godot --headless --path <export> --script res://test_save.gd` must print `OK`.

## Content rules

No Quran, scripture, Arabic calligraphy, sacred figures or depictions of the Prophet in text or art. Greetings such as
Assalamualaikum are fine as everyday speech. Keep the cast and text multicultural (Thai, Malay-Muslim, Chinese-Thai).
