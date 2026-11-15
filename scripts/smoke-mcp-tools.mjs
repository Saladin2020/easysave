/** MCP smoke test: start the server over stdio and over HTTP like a client would and call tools. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ws = mkdtempSync(path.join(os.tmpdir(), "easysave-smoke-"));
execFileSync("npx", ["tsx", "src/cli.ts", "init", "--workspace", ws], { stdio: "ignore" });
const fail = (m) => {
  console.error("FAIL", m);
  process.exitCode = 1;
};
const body = (r) => JSON.parse(r.content?.[0]?.text ?? "{}");

async function exercise(client, label) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`[${label}] tools (${tools.length}):`, tools.join(", "));
  if (tools.length !== 11) fail(`${label}: expected 11 tools`);
  const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
  console.log(`[${label}] schemas=${info.schemas?.map((s) => `${s.id} v${s.version}`)} saves=${info.saves?.length} keys=${info.strings?.keys}`);
  if (info.strings?.keys !== 322) fail(`${label}: workspace_info`);
  const slots = body(await client.callTool({ name: "list_slots", arguments: {} }));
  console.log(`[${label}] slots:`, slots.slots?.map((s) => `${s.slot}${s.exists ? "" : "(empty)"}`).join(", "));
  const m = body(await client.callTool({ name: "migrate_save", arguments: { data: { player: { coins: 5 } }, version: 1 } }));
  console.log(`[${label}] migrate v1: ok=${m.ok} money=${m.data?.player?.money}`);
  if (m.data?.player?.money !== 5) fail(`${label}: migrate_save`);
  const st = body(await client.callTool({ name: "list_strings", arguments: { prefix: "save.", limit: 3 } }));
  console.log(`[${label}] strings save.*: ${st.total}`, st.strings?.map((e) => `${e.key}=${e.ms}`).join(" | "));
  const chk = body(await client.callTool({ name: "check_all", arguments: {} }));
  console.log(`[${label}] check ok=${chk.ok}`);
  if (!chk.ok) fail(`${label}: check_all`);
}

{
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts", "--workspace", ws], cwd: process.cwd(), env: { ...process.env }, stderr: "ignore" }));
  await exercise(client, "stdio");
  const exp = body(await client.callTool({ name: "export_save", arguments: { preset: "web" } }));
  console.log("[stdio] export web:", exp.dirs?.map((d) => path.relative(ws, d)).join(", "), "files", exp.files);
  if (!exp.files) fail("stdio: export_save");
  await client.close();
}

{
  const port = 18899 + Math.floor(Math.random() * 500);
  const proc = spawn("npx", ["tsx", "src/mcp/server.ts", "--http", "--port", String(port), "--workspace", ws], { stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MCP HTTP did not start")), 20000);
    proc.stderr.on("data", (d) => {
      if (/listening|http:\/\//i.test(String(d))) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const client = new Client({ name: "smoke-http", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await exercise(client, "http");
  await client.close();
  proc.kill();
}

rmSync(ws, { recursive: true, force: true });
console.log(process.exitCode ? "MCP smoke FAILED" : "MCP smoke OK");
process.exit(process.exitCode ?? 0);
