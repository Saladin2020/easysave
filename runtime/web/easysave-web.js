// Easy Save web runtime: localStorage save slots + i18n for plain web or PixiJS games. MIT.
//
//   import { loadEasySave } from "./easysave-web.js";
//   const es = await loadEasySave(".");                 // fetches schema.json + strings.json
//   es.saves.save("slot_1", data, { label: "ตลาดเช้า" });
//   const r = es.saves.load("slot_1");                  // { ok, data, meta, migratedFrom, usedBackup }
//   const stop = es.startAutosave(() => game.state);    // every schema.slots.autosave.intervalSec
//   es.setLocale("ms"); text.text = es.i18n.tw("save.title");
import { I18n, SaveStore, defaults as schemaDefaults, thaiWrapHints } from "./easysave-core.js";

export * from "./easysave-core.js";

/** SaveStorage over localStorage (or any Storage), keys prefixed per game. */
export function webStorage(prefix = "", store = globalThis.localStorage) {
  const mem = new Map();
  const ls = store ?? { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  return {
    get: (k) => ls.getItem(prefix + k),
    set: (k, v) => ls.setItem(prefix + k, v),
    remove: (k) => ls.removeItem(prefix + k),
  };
}

/**
 * Load schema.json and strings.json from base and wire a SaveStore + I18n.
 * opts.seed: copy saves/*.save.json into empty storage (demo). opts.locale: initial locale (else the saved choice,
 * else the browser language when supported, else the source locale).
 */
export async function loadEasySave(base = ".", opts = {}) {
  const get = (f) => fetch(`${base}/${f}`).then((r) => {
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  });
  const [schema, strings] = await Promise.all([get("schema.json"), get("strings.json")]);
  const storage = opts.storage ?? webStorage(`${schema.id}/`);
  const saves = new SaveStore(schema, storage);
  const locales = strings.locales ?? ["th", "en", "ms"];
  const nav = (globalThis.navigator?.language ?? "").slice(0, 2);
  const locale = opts.locale ?? storage.get("locale") ?? (locales.includes(nav) ? nav : strings.source ?? locales[0]);
  const i18n = new I18n(strings.strings, { locale, fallback: strings.fallback ?? ["en", strings.source ?? "th"] });

  const seed = async (force = false) => {
    let ids = [];
    try {
      ids = await get("saves/index.json");
    } catch {
      return 0;
    }
    let n = 0;
    for (const id of ids) {
      if (!force && storage.get(saves.key(id)) !== null) continue;
      if (!saves.isSlot(id)) continue;
      const text = await fetch(`${base}/saves/${id}.save.json`).then((r) => r.text());
      storage.set(saves.key(id), text);
      n++;
    }
    return n;
  };
  if (opts.seed && saves.list().every((s) => !s.exists)) await seed();

  let timer = null;
  return {
    schema,
    strings,
    storage,
    saves,
    i18n,
    locales,
    defaults: () => schemaDefaults(schema),
    wrap: thaiWrapHints,
    setLocale(loc) {
      i18n.setLocale(loc);
      storage.set("locale", loc);
    },
    autosave: (data, meta) => saves.autosave(data, meta),
    /** Autosave every intervalSec; returns a stop function. */
    startAutosave(getData, getMeta) {
      const sec = schema.slots.autosave?.intervalSec;
      if (!sec) return () => {};
      clearInterval(timer);
      timer = setInterval(() => saves.autosave(getData(), getMeta?.() ?? {}), sec * 1000);
      return () => clearInterval(timer);
    },
    /** Remove every slot (and backups), then copy the sample saves again. */
    reset() {
      for (const s of saves.slots()) saves.remove(s.slot);
      return seed(true);
    },
  };
}
