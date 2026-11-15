import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { defaults, migrate, normalize } from "../core/schema.js";
import { readSlot, verifySlot } from "../core/slot.js";
import { FIELD_TYPES, LOCALES, MIGRATION_OPS, type Locale, type StringsDoc } from "../core/types.js";
import { toCsv } from "../shared/csv.js";
import { toPo } from "../shared/po.js";
import { THAI_FONTS } from "../shared/fonts.js";
import { EXPORT_PRESETS, exportSave, type ExportPreset } from "../lib/export.js";
import { assertSafeId, checkWorkspace, extractInto, listSchemas, loadConfig, loadSchema, loadStrings, missingKeys, saveSchema, saveStore, writeStrings } from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easysave_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Save</title>
<body style="font-family:system-ui;background:#141820;color:#e6edf5;padding:2rem">
<h1>Easy Save token required</h1>
<p>Paste the token printed in the terminal that started Easy Save.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easysave-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => {
    const cfg = await loadConfig(root);
    const schemas = await listSchemas(root);
    return c.json({ root, config: cfg, schemas: schemas.map((s) => ({ id: s.id, version: s.schema?.version, errors: s.diagnostics.filter((d) => d.severity === "error").length })), fieldTypes: FIELD_TYPES, migrationOps: MIGRATION_OPS, locales: LOCALES, presets: EXPORT_PRESETS, fonts: THAI_FONTS });
  });
  app.get("/api/check", async (c) => c.json(await checkWorkspace(root, { strict: c.req.query("strict") === "1" })));

  // ---------------------------------------------------------------- schema
  app.get("/api/schema", async (c) => {
    try {
      const schema = await loadSchema(root, c.req.query("id") || undefined);
      return c.json({ schema, defaults: defaults(schema) });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });
  app.post("/api/schema/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { schema: unknown; dryRun?: boolean };
      const r = await saveSchema(root, c.req.param("id"), body.schema, { dryRun: body.dryRun });
      return c.json({ ok: r.ok, file: r.file, diagnostics: r.diagnostics });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  // ---------------------------------------------------------------- slots
  app.get("/api/slots", async (c) => {
    try {
      const store = await saveStore(root);
      return c.json({ slots: store.list() });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.get("/api/slots/:slot", async (c) => {
    try {
      const store = await saveStore(root);
      const slot = assertSafeId(c.req.param("slot"), "slot");
      if (!store.isSlot(slot)) return c.json({ error: `unknown slot ${slot}` }, 404);
      const text = store.storage.get(store.key(slot));
      return c.json({ result: store.load(slot), file: text ? JSON.parse(text) : null });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.post("/api/slots/:slot", async (c) => {
    try {
      const store = await saveStore(root);
      const body = (await c.req.json()) as { data?: unknown; label?: string; playtime?: number };
      const meta = { ...(body.label ? { label: body.label } : {}), ...(typeof body.playtime === "number" ? { playtime: body.playtime } : {}) };
      const data = body.data ?? defaults(store.schema);
      const slot = c.req.param("slot");
      const r = slot === "auto" ? store.autosave(data, meta) : store.save(assertSafeId(slot, "slot"), data, meta);
      return c.json(r, r.ok ? 200 : 400);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.delete("/api/slots/:slot", async (c) => {
    try {
      const store = await saveStore(root);
      const slot = assertSafeId(c.req.param("slot"), "slot");
      if (!store.isSlot(slot)) return c.json({ error: `unknown slot ${slot}` }, 404);
      store.remove(slot);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  /** Check a pasted save file (any slot, any version) without writing it. */
  app.post("/api/validate", async (c) => {
    try {
      const body = (await c.req.json()) as { save: unknown };
      const schema = await loadSchema(root);
      return c.json({ checksum: verifySlot(body.save), result: readSlot(schema, body.save) });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  /** Run the migrations on raw data from a given version (dry run for the Schema tab). */
  app.post("/api/migrate", async (c) => {
    try {
      const body = (await c.req.json()) as { data: Record<string, unknown>; version: number };
      const schema = await loadSchema(root);
      const m = migrate(schema, body.data, body.version);
      if (!m.ok) return c.json({ ok: false, error: m.error, steps: m.steps });
      const n = normalize(schema, m.data);
      return c.json({ ok: !n.diagnostics.some((d) => d.severity === "error"), steps: m.steps, data: n.data, diagnostics: n.diagnostics });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  // ---------------------------------------------------------------- strings
  app.get("/api/strings", async (c) => {
    const docs = await loadStrings(root);
    const check = await checkWorkspace(root);
    const mk = await missingKeys(root);
    return c.json({ tables: docs, coverage: check.strings.coverage, diagnostics: check.strings.diagnostics, sourceKeysMissing: mk.missing.length, orphans: mk.orphans });
  });
  app.post("/api/strings/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { doc: StringsDoc; dryRun?: boolean };
      if (body.doc?.id !== c.req.param("id")) throw new Error("doc.id must match the URL");
      const r = await writeStrings(root, body.doc, { dryRun: body.dryRun });
      return c.json(r, r.ok ? 200 : 400);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  /** Set one translation: { key, locale, text } — clears that locale's stale flag. */
  app.post("/api/strings/:id/set", async (c) => {
    try {
      const body = (await c.req.json()) as { key: string; locale: Locale; text: string };
      const docs = await loadStrings(root);
      const doc = docs.find((d) => d.id === c.req.param("id"));
      if (!doc) return c.json({ error: `no table ${c.req.param("id")}` }, 404);
      const e = doc.strings[body.key];
      if (!e) return c.json({ error: `no key ${body.key} in ${doc.id}` }, 404);
      if (!LOCALES.includes(body.locale)) throw new Error(`locale ${body.locale}`);
      if (body.text) e[body.locale] = body.text;
      else delete e[body.locale];
      if (e.stale) {
        e.stale = e.stale.filter((l) => l !== body.locale);
        if (!e.stale.length) delete e.stale;
      }
      const r = await writeStrings(root, doc);
      return c.json({ ...r, entry: e }, r.ok ? 200 : 400);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.post("/api/extract", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { prune?: boolean; dryRun?: boolean };
      return c.json(await extractInto(root, { prune: body.prune, dryRun: body.dryRun }));
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.get("/api/strings.csv", async (c) => {
    const cfg = await loadConfig(root);
    return c.body(toCsv(await loadStrings(root), cfg.locales), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="strings.csv"' });
  });
  app.get("/api/po/:locale", async (c) => {
    const cfg = await loadConfig(root);
    const loc = c.req.param("locale") as Locale;
    if (!cfg.locales.includes(loc)) return c.json({ error: `locale ${loc}` }, 404);
    return c.body(toPo(await loadStrings(root), loc, cfg.sourceLocale), 200, { "Content-Type": "text/x-gettext-translation; charset=utf-8", "Content-Disposition": `attachment; filename="strings.${loc}.po"` });
  });

  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { preset?: ExportPreset; out?: string };
      const res = await exportSave(root, { preset: body.preset, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy Save (dev)</title>
<body style="font-family:system-ui;background:#141820;color:#e6edf5;padding:2rem">
<h1>Easy Save API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5186" style="color:#9fb4cc">http://127.0.0.1:5186</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}
