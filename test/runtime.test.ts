import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("runtime/web/easysave-core.js", () => {
  it("is up to date with src/core (npm run build:runtime)", () => {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/build-runtime.mjs"), "--check"], { encoding: "utf8" });
    expect(r.stderr + r.stdout).not.toMatch(/out of date/i);
    expect(r.status).toBe(0);
  });
});
