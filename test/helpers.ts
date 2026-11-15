import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initWorkspace } from "../src/lib/workspace.js";

export async function tempWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "easysave-test-"));
  await initWorkspace(root);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** In-memory SaveStorage. */
export function memStorage() {
  const m = new Map<string, string>();
  return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k) };
}
