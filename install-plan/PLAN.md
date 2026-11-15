# Easy Save studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

1. `git clone /workspace/easysave /workspace/indie-studio/tools/easysave && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (expect 49 passed, 1 skipped; `GODOT=… npx vitest run test/godot.test.ts` for the Godot check).
3. Copy `install-plan/easysave-cli.mjs` → `/workspace/indie-studio/tools/easysave-cli.mjs` (same shape as the other
   `easy*-cli.mjs` wrappers: sets `EASYSAVE_HOME`, `EASYSAVE_WORKSPACE`, adds `/workspace/indie-studio/projects` to
   `EASYSAVE_ALLOWED_DIRS`).
4. Copy `install-plan/EASYSAVE.md` → `/workspace/indie-studio/tools/EASYSAVE.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easysave-cli.mjs init --workspace /workspace/indie-studio/projects/_smoke_save`
   then `check`, `slots`, `strings --missing --locale ms` and `export --preset godot` with the same `--workspace`.
6. For a real game (e.g. ThaiVillageDelivery): point `sources` in its `easysave.config.json` at the project's
   `dialogues/`, `quests/`, `ui/` and `items/` folders and run `extract` (writes only `strings/` in that workspace).
7. Shared skill: install `SKILL.draft.md` as `easysave-i18n` (the parent agent does this).
8. Once a GitHub repo exists (user's call): `git remote add github https://github.com/Saladin2020/easysave.git` in the install.

Ports: editor 8898, MCP HTTP 8899, Vite 5186 (Easy FX 8848 / 8849 / 5180, Easy Items 8878 / 8879 / 5185).
