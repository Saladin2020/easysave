"""Screenshot the web editor (needs `easysave serve` running).

  python3 scripts/capture-ui.py [url] [out.png] [tab] [item-id]

tab: Schema | Slots | Strings (matched by the start of the tab label)
"""
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8898/"
out = sys.argv[2] if len(sys.argv) > 2 else "docs/assets/editor.png"
tab = sys.argv[3] if len(sys.argv) > 3 else "Slots"
pick = sys.argv[4] if len(sys.argv) > 4 else "slot_1"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(url)
    pg.wait_for_timeout(1200)
    t = pg.get_by_role("button", name=tab, exact=False).first
    if t.count():
        t.click()
        pg.wait_for_timeout(400)
    loc = pg.get_by_text(pick, exact=False).first
    if pick and loc.count():
        loc.click()
    pg.wait_for_timeout(1200)
    pg.screenshot(path=out)
    b.close()
    print("errors:", errors)
    print(out)
