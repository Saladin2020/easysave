/** CLI smoke test: init a temp workspace and drive every command through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easysave-cli-"));
const cli = (...args) => execFileSync("npx", ["tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cliFail = (...args) => {
  try {
    cli(...args);
    return "";
  } catch (e) {
    return String(e.stdout) + String(e.stderr);
  }
};
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};

cli("init");
ok(existsSync(path.join(ws, "schemas", "village_delivery.easysave.json")) && existsSync(path.join(ws, "strings", "save_ui.easyi18n.json")), "init copies schema, saves, strings, sources");
ok(/slot_1 \(v1→v3\)/.test(cli("info")), "info: slot_1 migrates v1→v3");
ok(/migration v2→v3/.test(cli("schema")), "schema lists migrations");
ok(typeof JSON.parse(cli("defaults")).player.money === "number", "defaults prints JSON");
const chk = cli("check");
ok(/0 errors/.test(chk) && /^ok$/m.test(chk), "check: clean");
ok(/FAIL/.test(cliFail("check", "--strict")), "check --strict fails on missing translations");
ok(/checksum: ok/.test(cli("verify", path.join(ws, "saves", "slot_1.save.json"))), "verify slot_1");
const tampered = path.join(ws, "tampered.json");
writeFileSync(tampered, readFileSync(path.join(ws, "saves", "slot_2.save.json"), "utf8").replace(/"day": \d+/, '"day": 99'));
ok(/MISMATCH/.test(cliFail("verify", tampered)), "verify catches a hand-edited save (exit 1)");
const migrated = path.join(ws, "migrated.json");
ok(/v1 → v2:.*v2 → v3:/s.test(cli("migrate", path.join(ws, "saves", "slot_1.save.json"), "--out", migrated)) && JSON.parse(readFileSync(migrated, "utf8")).version === 3, "migrate --out writes a v3 save");
cli("save", "slot_3", "--label", "smoke");
cli("save", "slot_3", "--label", "smoke 2");
ok(existsSync(path.join(ws, "saves", "slot_3.save.json.bak")) || existsSync(path.join(ws, "saves", "slot_3.save.json")), "save slot_3 twice");
cli("save", "auto");
const slots = cli("slots");
ok(/slot_3\s+ok v3 .* smoke 2 · \.bak/.test(slots) && /auto_1\s+ok/.test(slots), "slots: backup and autosave rotation");
ok(/0 new/.test(cli("extract", "--dry-run")), "extract: sources already extracted");
ok(/dialogue\s+110 keys/.test(cli("strings")) && /ms dlg\./.test(cli("strings", "--missing", "--locale", "ms")), "strings / --missing");
cli("strings-export", "--format", "csv", "--out", path.join(ws, "t.csv"));
cli("strings-export", "--format", "po", "--out", path.join(ws, "po"));
ok(readFileSync(path.join(ws, "t.csv"), "utf8").startsWith("keys,th,en,ms") && existsSync(path.join(ws, "po", "strings.ms.po")), "strings-export csv + po");
const csv = readFileSync(path.join(ws, "t.csv"), "utf8").replace(/^(save\.title,[^,]*,[^,]*),[^\n]*$/m, "$1,Simpan permainan (uji)");
writeFileSync(path.join(ws, "t.csv"), csv);
ok(/1 updated/.test(cli("strings-import", path.join(ws, "t.csv"))) && JSON.parse(readFileSync(path.join(ws, "strings", "save_ui.easyi18n.json"), "utf8")).strings["save.title"].ms === "Simpan permainan (uji)", "strings-import csv");
ok(/Kanit/.test(cli("fonts")), "fonts notes");
cli("export", "--preset", "all");
for (const f of ["exports/easysave-godot/project.godot", "exports/easysave-godot/easysave/save_manager.gd", "exports/easysave-godot/test_save.gd", "exports/easysave-web/index.html", "exports/easysave-web/easysave-web.js", "exports/easysave-strings/ms.po"]) ok(existsSync(path.join(ws, f)), `export → ${f}`);

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
