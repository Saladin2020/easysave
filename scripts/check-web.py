"""Headless Chrome check of the web export: localStorage slots, migration, backup fallback, autosave, locale switch.

  python3 scripts/check-web.py <web-export-dir> [screenshot.png]

Serves the folder on 127.0.0.1:8988 and drives the demo page with real clicks:
  1. first run seeds the sample saves (slot_1 is a v1 save) → load slot_1 reports a v1 migration
  2. play, save to slot_3, reload the page, load slot_3 → same day and money
  3. save over slot_1 (keeps .bak), corrupt slot_1 → load falls back to the backup
  4. autosave twice → auto_0 and auto_1 exist (rotation)
  5. switch to Malay and English → slot names change, Thai text gone from the slot list
Prints a JSON report; exit 1 on any failure or console error.
"""
import asyncio, json, re, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8988
THAI = re.compile("[\u0e01-\u0e3a\u0e40-\u0e5b]")
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    problems, steps = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        pg = await b.new_page(viewport={"width": 900, "height": 760})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("response", lambda r: errs.append(f"http {r.status}: {r.url}") if r.status >= 400 and not r.url.endswith("favicon.ico") else None)
        url = f"http://127.0.0.1:{PORT}/index.html"
        await pg.goto(url)
        await pg.wait_for_function("window.__ready === true", timeout=20000)

        async def act(slot, what):
            await pg.click(f'.slot[data-slot="{slot}"] button[data-act="{what}"]')
            await pg.wait_for_timeout(60)
            return await pg.evaluate("document.getElementById('log').textContent.split('\\n')[0]")

        def check(ok, msg, extra=None):
            steps.append({"ok": bool(ok), "step": msg, **({"detail": extra} if extra is not None else {})})
            if not ok:
                problems.append(msg)

        st = lambda: pg.evaluate("({ day: window.__save.state.day, money: window.__save.state.player.money })")
        line = await act("slot_1", "load")
        check("1" in line and await pg.evaluate("window.__save.saves.load('slot_1').migratedFrom") == 1, "seeded v1 save loads with migration", line)
        await pg.click("#play"); await pg.click("#play")
        before = await st()
        line = await act("slot_3", "save")
        check("slot_3" in line, "save slot_3", line)
        await pg.reload()
        await pg.wait_for_function("window.__ready === true", timeout=20000)
        await act("slot_3", "load")
        after = await st()
        check(before == after, "slot_3 survives a page reload", {"before": before, "after": after})
        await act("slot_1", "save")
        check(await pg.evaluate("window.__save.saves.list().find(s => s.slot === 'slot_1').hasBackup"), "saving over slot_1 keeps a .bak")
        await pg.click("#tamper")
        corrupt = await pg.evaluate("window.__save.saves.list().find(s => s.slot === 'slot_1')")
        line = await act("slot_1", "load")
        r = await pg.evaluate("window.__save.saves.load('slot_1')")
        check(corrupt["ok"] is False and r["ok"] and r.get("usedBackup"), "corrupted slot_1 falls back to the backup", {"listed": corrupt.get("reason"), "log": line})
        await pg.click("#autosave"); await pg.click("#play"); await pg.click("#autosave")
        a = await pg.evaluate("window.__save.saves.list().filter(s => s.kind === 'auto').map(s => ({ slot: s.slot, ok: s.ok, day: s.exists ? window.__save.saves.load(s.slot).data.day : null }))")
        check(all(x["ok"] for x in a) and a[0]["day"] == a[1]["day"] + 1, "autosave rotates auto_0 → auto_1", a)
        texts = {}
        for loc in ("ms", "en", "th"):
            await pg.click(f'button[data-lang="{loc}"]')
            await pg.wait_for_timeout(80)
            texts[loc] = await pg.evaluate("document.getElementById('slots').innerText")
        check(not THAI.search(texts["ms"].split("\n")[0]) and not THAI.search(texts["en"].split("\n")[0]) and THAI.search(texts["th"]), "locale switch changes the slot list", {k: v.split("\n")[0] for k, v in texts.items()})
        await pg.click('button[data-lang="th"]')
        if SHOT:
            await pg.screenshot(path=SHOT, full_page=True)
        await b.close()
    srv.terminate()
    if errs:
        problems.append(f"console: {errs[:5]}")
    print(json.dumps({"ok": not problems, "steps": steps, "problems": problems}, ensure_ascii=False, indent=2))
    sys.exit(1 if problems else 0)

asyncio.run(main())
