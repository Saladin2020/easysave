// Bundle the browser-safe core (src/core) into runtime/web/easysave-core.js (ESM, no dependencies).
//   node scripts/build-runtime.mjs [--check]   (--check exits 1 when the committed file is out of date)
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "runtime/web/easysave-core.js");

export async function bundleCore() {
  const r = await build({
    entryPoints: [path.join(root, "src/core/index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    legalComments: "none",
    banner: { js: "// Easy Save core runtime (generated from src/core by scripts/build-runtime.mjs; do not edit). MIT." },
  });
  return r.outputFiles[0].text;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const js = await bundleCore();
  if (process.argv.includes("--check")) {
    const cur = readFileSync(out, "utf8");
    if (cur !== js) {
      console.error("runtime/web/easysave-core.js is out of date: run node scripts/build-runtime.mjs");
      process.exit(1);
    }
    console.log("runtime up to date");
  } else {
    writeFileSync(out, js);
    console.log(`wrote ${path.relative(root, out)} (${js.length} bytes)`);
  }
}
