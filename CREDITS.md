# Credits

## Sample data (CC0 1.0)

* The sample schema, saves, string tables and source files (`samples/`) were written for Easy Save. The dialogue,
  quest, UI and item sources are small copies of the other Easy Suite samples (Easy Dialogue, Easy Quest, Easy UI,
  Easy Items). All of it, and everything you export from it, is dedicated to the public domain (CC0 1.0).
* `test/fixtures/tvd_delivery.*` is the Thai Village Delivery dialogue and its Easy Dialogue compile, used only to
  check that extracted line ids match the compiler's.
* Content rules for the samples: no depiction of the Prophet or of sacred figures; no Quran, scripture or Arabic
  calligraphy; halal-appropriate food; Thai village, Malay-Muslim and Chinese-Thai life side by side. Greetings such
  as "อัสสะลามุอะลัยกุม / Assalamualaikum" appear as everyday speech only.

## Fonts

* **Kanit** (Cadson Demak, SIL Open Font License 1.1) is bundled in `assets/fonts/` with `OFL.txt` and copied into
  the Godot and web exports so Thai text renders out of the box.
* **Press Start 2P** (SIL OFL 1.1) appears only in the README art (`docs/brand/`).

## Runtimes

* `runtime/web/easysave-core.js` is generated from `src/core` with esbuild (MIT); it has no dependencies.
* Godot exports target Godot 4.3+ (MIT); nothing from the engine is included.
* Checksums use FNV-1a 32 (public domain algorithm by Fowler, Noll and Vo). They catch accidental corruption and
  casual hand edits; they are **not** a security feature (anyone can recompute them).
