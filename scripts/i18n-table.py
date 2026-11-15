"""Render a sample of the string tables (key, ไทย, English, Melayu) as a PNG with Kanit.

  python3 scripts/i18n-table.py [workspace=.] [out=docs/assets/i18n-table.png]

Missing cells are drawn as "→ fallback" in red; stale ones in amber.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

WS = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/assets/i18n-table.png"
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "assets", "fonts", "Kanit-Regular.ttf")
FONT_M = os.path.join(HERE, "..", "assets", "fonts", "Kanit-Medium.ttf")
PICK = [
    ("save_ui", ["save.title", "save.load_title", "save.slot", "save.auto", "save.money", "save.migrated", "save.corrupt", "save.used_backup"]),
    ("items", ["item.ketupat.name", "item.mango_sticky_rice.name", "shop.raya_bazaar.name"]),
    ("quests", ["quest.iftar_share.title", "quest.help_tomorrow.title"]),
    ("dialogue", None),
]
BG, ROW, ROW2, INK, CREAM, MUTED, GOLD, ROSE, SILVER = (20, 14, 10), (42, 29, 19), (34, 24, 16), (13, 9, 6), (247, 235, 211), (151, 128, 95), (244, 174, 61), (229, 128, 108), (159, 180, 204)

tables = {}
sd = os.path.join(WS, "strings") if os.path.isdir(os.path.join(WS, "strings")) else os.path.join(HERE, "..", "samples", "strings")
for f in sorted(os.listdir(sd)):
    if f.endswith(".easyi18n.json"):
        d = json.load(open(os.path.join(sd, f)))
        tables[d["id"]] = d["strings"]
rows = []
for t, keys in PICK:
    s = tables.get(t, {})
    if keys is None:  # first translated + first untranslated dialogue line
        done = [k for k, e in s.items() if e.get("en") and e.get("ms") and "." in k and not k.endswith(".title")][:2]
        todo = [k for k, e in s.items() if not e.get("ms") and not k.endswith(".title")][:2]
        keys = done + todo
    rows += [(k, s[k]) for k in keys if k in s]

f_k, f_t, f_h = ImageFont.truetype(FONT, 15), ImageFont.truetype(FONT, 19), ImageFont.truetype(FONT_M, 18)
COLS = [("key", 300), ("ไทย · th", 400), ("English · en", 360), ("Melayu · ms", 360)]
PAD, RH, HH = 14, 46, 48
W = sum(w for _, w in COLS) + PAD * 2
H = HH + RH * len(rows) + PAD * 2 + 30
im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)
x = PAD
d.rectangle([PAD, PAD, W - PAD, PAD + HH], fill=INK)
for name, w in COLS:
    d.text((x + 10, PAD + HH // 2), name, font=f_h, fill=SILVER, anchor="lm")
    x += w

def fit(s, font, w):
    if d.textlength(s, font=font) <= w:
        return s
    while s and d.textlength(s + "…", font=font) > w:
        s = s[:-1]
    return s + "…"

for i, (k, e) in enumerate(rows):
    y = PAD + HH + i * RH
    d.rectangle([PAD, y, W - PAD, y + RH], fill=ROW if i % 2 else ROW2)
    x = PAD
    for j, (name, w) in enumerate(COLS):
        if j == 0:
            d.text((x + 10, y + RH // 2), fit(k, f_k, w - 20), font=f_k, fill=MUTED, anchor="lm")
        else:
            loc = ["th", "en", "ms"][j - 1]
            v, col = e.get(loc), CREAM
            if e.get("fixed") and loc != "th":
                v, col = "= th", MUTED
            elif not v:
                v, col = "→ " + ("en" if e.get("en") else "th"), ROSE
            elif loc in (e.get("stale") or []):
                col = GOLD
            d.text((x + 10, y + RH // 2), fit(v, f_t, w - 20), font=f_t, fill=col, anchor="lm")
        x += w
d.text((PAD, H - PAD - 8), "Easy Save · strings/*.easyi18n.json · red = missing (runtime falls back locale → en → th) · amber = stale", font=f_k, fill=MUTED, anchor="lm")
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
im.save(OUT, optimize=True)
print(OUT, f"{len(rows)} rows")
