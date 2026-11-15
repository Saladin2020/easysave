---
name: easysave-i18n
description: >-
  Use when a game needs save slots (manual, quick, autosave rotation), a versioned save schema with migrations so
  old saves keep loading, checksum / backup handling for corrupt saves, or Thai / English / Malay string tables
  extracted from Easy Dialogue, Quest, UI and Items files (CSV / PO for translators), exported as a Godot 4.3+
  SaveManager + I18n setup or a web / PixiJS runtime. Not for cloud saves or encryption.
---
# Easy Save + i18n

Easy Save **checks, migrates and exports** `easysave/1` schemas, `easysave-slot/1` saves and `easyi18n/1` string
tables. Read `/workspace/indie-studio/tools/EASYSAVE.md` for paths, commands and import details; full format:
`/workspace/indie-studio/tools/easysave/docs/FORMAT.md`.

## Setup

Install: `/workspace/indie-studio/tools/easysave`. CLI: `node /workspace/indie-studio/tools/easysave-cli.mjs`.
Game files go under `/workspace/indie-studio/projects/<Name>/` (`init --workspace` once). Ports: editor 8898,
MCP HTTP 8899, Vite 5186.

## Steps

1. **Schema.** List what the game must remember (player, scene, quest state, items, flags, settings). Write fields
   with defaults; `check` must report 0 errors. Keep a fixture save of every released version in `saves/`.
2. **Change shape → migrate.** Never edit a released field in place: bump `version` and add a migration
   (`rename`, `copy`, `add`, `set`, `delete`, `map`, `wrap`; `*` wildcards). `check` loads every fixture save through
   the migrations; `migrate_save` (MCP) shows the result.
3. **Strings.** Set `sources` to the game's dialogue / quest / UI / item folders, run `extract`. Thai is the source;
   translate with `strings --missing --locale en|ms` and `set_strings` (or CSV / PO round trip). Keep `{placeholders}`
   identical; mind `max` on UI text. Re-run `extract` after content changes and fix `stale` entries.
4. **Check.** `check` (or `--strict` before a release: every key translated, no source key missing from the tables).
5. **Export.** `export --preset godot` (run `test_save.gd` headless, expect `OK`) or `web`.

## Rules

- Do not hand-edit `checksum`; write saves through the CLI, editor or runtime.
- Never push to GitHub or touch other repos; the user approves pushes.
- Content: no Quran / scripture / Arabic calligraphy, no sacred figures or depictions of the Prophet; multicultural cast.
