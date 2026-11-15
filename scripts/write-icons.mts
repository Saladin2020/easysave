/**
 * Bake favicon / PWA icons: the Easy Save logo (24×24, floppy disk + speech bubble; same pixels as
 * easy-suite-brand logo-save.png).
 * Usage: npx tsx scripts/write-icons.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/lib/png.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "public");
const N = 24;

const PAL: Record<string, [number, number, number, number]> = {
  ".": [0, 0, 0, 0],
  _: [26, 18, 11, 255],
  a: [215, 241, 255, 255],
  b: [111, 125, 142, 255],
  c: [46, 32, 20, 255],
  d: [60, 42, 27, 255],
  e: [159, 180, 204, 255],
  f: [246, 231, 200, 255],
  g: [98, 111, 126, 255],
  h: [43, 29, 20, 255],
  i: [228, 255, 255, 255],
  j: [86, 160, 210, 255],
  k: [214, 72, 56, 255],
};
export const ART = [
  "..____________________..",
  "._aaaaaaaaaaaaaaaaaaaa_.",
  "_a____________________b_",
  "_a_ccccccccccdccccccc_b_",
  "_a_cdcccccccccccccccc_b_",
  "_a_cc____________cccc_b_",
  "_a_cc_eefffffeegg_ccc_b_",
  "_a_cc_eeffhhfeeeg_ccc_b_",
  "_a_cc_eeffhhfeeeg_ccc_b_",
  "_a_cc_eefffffeeeg_cdc_b_",
  "_a_cc_eeeeeeeeeeg_ccc_b_",
  "_a_cc_eiiiiiiiiie_ccc_b_",
  "_a_cc_eiffffff______c_b_",
  "_a_dc_eifhhhh_fffff_c_b_",
  "_a_cc_eifffff_fjfkf_c_b_",
  "_a_cc_eifhhhf_fffff_c_b_",
  "_a_cc_eiffffff_____cc_b_",
  "_a_cc______________cc_b_",
  "_a_cccccccccccc_ccdcc_b_",
  "_a_ccccccdccccccccccc_b_",
  "_a_cccccccccccccccccd_b_",
  "_a____________________b_",
  "._bbbbbbbbbbbbbbbbbbbb_.",
  "..____________________..",
];

function render(size: number): Buffer {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) px.set(PAL[ART[Math.floor((y * N) / size)]![Math.floor((x * N) / size)]!] ?? PAL["."]!, (y * size + x) * 4);
  return encodePng(size, size, px);
}

if (ART.some((r) => r.length !== N)) throw new Error("icon rows must be 24 wide");
await mkdir(outDir, { recursive: true });
await mkdir(path.join(root, "docs", "assets"), { recursive: true });
for (const [name, size] of [["favicon-48.png", 48], ["icon-192.png", 192], ["icon-512.png", 480], ["apple-touch-icon.png", 192]] as const) await writeFile(path.join(outDir, name), render(size));
await writeFile(path.join(root, "docs", "assets", "icon-512.png"), render(480));
const rects: string[] = [];
ART.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${PAL[ch]!.slice(0, 3).join(",")})"/>`)));
await writeFile(path.join(outDir, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">${rects.join("")}</svg>\n`);
await writeFile(path.join(outDir, "site.webmanifest"), `${JSON.stringify({ name: "Easy Save", short_name: "Easy Save", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "480x480", type: "image/png" }], theme_color: "#9fb4cc", background_color: "#141820", display: "standalone" }, null, 2)}\n`);
console.log("icons written");
