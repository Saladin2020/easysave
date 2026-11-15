import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root, whether running from src/lib (tsx), dist/ (built) or a test. */
export const pkgRoot = [path.resolve(here, "../.."), path.resolve(here, "..")].find((p) => existsSync(path.join(p, "samples", "schemas"))) ?? path.resolve(here, "../..");

export const RUNTIME_DIR = path.join(pkgRoot, "runtime");
export const FONT_DIR = path.join(pkgRoot, "assets", "fonts");
