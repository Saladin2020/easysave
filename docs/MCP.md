# Easy Save MCP server

```bash
npm run mcp                      # stdio
npm run mcp:http                 # http://127.0.0.1:8899/mcp (streamable HTTP)
node dist/mcp/server.js --workspace /path/to/game [--http --port 8899]
```

Client config (stdio):

```json
{ "mcpServers": { "easysave": { "command": "node", "args": ["/path/to/easysave/dist/mcp/server.js", "--workspace", "/path/to/game"] } } }
```

| Tool | Args | Returns |
|---|---|---|
| `workspace_info` | | schemas, save files, string coverage, export presets, the format cheat sheet with content rules, Thai font notes. Call first |
| `get_schema` | `id?` | the schema and a fresh save's data (`defaults`) |
| `write_schema` | `id`, `schema`, `dryRun?` | validates (consecutive migrations, field types); writes only without errors |
| `list_slots` | | every slot with `exists`, `ok`, `version`, `meta`, `hasBackup`, `reason` |
| `validate_save` | `save` (object or text) | `{ checksum: { ok, expected, actual }, result: { ok, reason, migratedFrom, data, diagnostics } }` |
| `migrate_save` | `data`, `version` | runs migrations from `version` and normalises: `{ ok, steps, data, diagnostics }`. Writes nothing |
| `list_strings` | `table?`, `prefix?`, `missing?` (locale), `limit?` | `{ coverage, total, strings: [{ table, key, th, en, ms, note, stale }] }` |
| `set_strings` | `entries: [{ key, locale, text }]` | writes the owning tables (empty text clears; clears `stale`). Refuses placeholder mismatches |
| `extract_strings` | `prune?`, `dryRun?` | per table: `added`, `changed` (now stale), `orphans` |
| `check_all` | `strict?` | `{ ok, schemas, saves, strings: { coverage, errors, warnings }, sourceKeysMissing }` |
| `export_save` | `preset?`, `out?` | written folders and file counts. `out` must stay inside the workspace |

Errors carry JSON paths (`village_delivery.easysave.json:migrations[1].ops[0].to`, `ui.easyi18n.json:strings.save.slot.ms`)
so an agent can fix them in place. Paths outside the workspace and `EASYSAVE_ALLOWED_DIRS` are refused.
