/** Thai (and Malay) font notes shown by `easysave fonts`, the editor and the exports' README. */
export const THAI_FONTS = {
  fonts: [
    { name: "Kanit", license: "SIL OFL 1.1", use: "UI and headings; the Easy Suite font. Bundled in exports (Regular).", url: "https://fonts.google.com/specimen/Kanit" },
    { name: "Sarabun", license: "SIL OFL 1.1", use: "Long dialogue and body text: looped, very readable at small sizes.", url: "https://fonts.google.com/specimen/Sarabun" },
    { name: "Noto Sans Thai / Noto Sans Thai Looped", license: "SIL OFL 1.1", use: "Fallback with full coverage; Looped for a traditional look.", url: "https://fonts.google.com/noto" },
    { name: "Pixel fonts", license: "varies", use: "Most pixel fonts have no Thai glyphs. Pair a Latin pixel font with Kanit as a fallback font, or render Thai at an integer size of a Thai font with antialiasing off.", url: "" },
  ],
  rules: [
    "Thai has no spaces between words. Line breaking needs a dictionary: Godot's TextServerAdvanced (ICU) does it; in exported games enable Project Settings → Internationalization → Locale → Include Text Server Data, otherwise Thai lines only break at spaces.",
    "PixiJS Text and canvas wrap only at spaces: run text through thaiWrapHints() (Intl.Segmenter) to insert zero-width spaces between words first. The web runtime offers i18n.tw(key) (translate + wrap hints) and thaiWrapHints().",
    "Vowels and tone marks stack above and below consonants (ป่า, ผู้, ที่). Keep line spacing ≥ 1.4 and leave 2–3 px of headroom in buttons and name plates so marks are not clipped.",
    "Never cut Thai strings by byte or code unit: a cut can leave a lone vowel or tone mark. Measure and truncate by grapheme cluster (Intl.Segmenter grapheme / Godot's TextServer).",
    "Typewriter effects should reveal whole grapheme clusters (Easy Dialogue does), not single code points.",
    "Thai numerals (๐–๙) are optional; most games use Arabic digits. Baht amounts: ฿25 or 25 บาท.",
    "Malay (ms) uses Latin script; strings run 20–40% longer than Thai. Check UI widths with the longest locale.",
    "Godot: set the theme's default font to Kanit/Sarabun and add Noto Sans Thai as a fallback font so mixed Thai/Latin/emoji text renders.",
  ],
} as const;

export function fontNotesText(): string {
  const lines = ["Thai font notes · ฟอนต์ภาษาไทย", ""];
  for (const f of THAI_FONTS.fonts) lines.push(`• ${f.name} (${f.license}): ${f.use}${f.url ? ` ${f.url}` : ""}`);
  lines.push("");
  for (const r of THAI_FONTS.rules) lines.push(`- ${r}`);
  return lines.join("\n");
}
