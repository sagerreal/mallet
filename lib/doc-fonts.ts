/**
 * The document's font choices — ONE list, read by the office toolbar, the office preview and
 * the customer page, so a key always resolves to the same stack on every surface.
 *
 * Web-safe system stacks only: the customer's copy is a public page that must not fetch a
 * webfont to render a contract. Every stack ends in a generic family, so an absent face
 * degrades to the platform's own.
 */
export const DOC_FONT_KEYS = [
  "basic", "system", "helvetica", "arial", "verdana", "trebuchet", "gill", "futura", "avenir",
  "serif", "georgia", "palatino", "times", "garamond", "baskerville", "bookman",
  "mono", "courier",
] as const;
export type DocFontKey = (typeof DOC_FONT_KEYS)[number];

export const DOC_FONTS: readonly { key: DocFontKey; label: string; stack: string; group: "Sans serif" | "Serif" | "Mono" }[] = [
  { key: "basic", label: "Default (sans)", stack: "", group: "Sans serif" },
  { key: "system", label: "System UI", stack: "system-ui, -apple-system, 'Segoe UI', sans-serif", group: "Sans serif" },
  { key: "helvetica", label: "Helvetica", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif", group: "Sans serif" },
  { key: "arial", label: "Arial", stack: "Arial, 'Helvetica Neue', sans-serif", group: "Sans serif" },
  { key: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif", group: "Sans serif" },
  { key: "trebuchet", label: "Trebuchet", stack: "'Trebuchet MS', 'Segoe UI', sans-serif", group: "Sans serif" },
  { key: "gill", label: "Gill Sans", stack: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif", group: "Sans serif" },
  { key: "futura", label: "Futura", stack: "Futura, 'Century Gothic', 'Avant Garde', sans-serif", group: "Sans serif" },
  { key: "avenir", label: "Avenir", stack: "Avenir, 'Avenir Next', Montserrat, sans-serif", group: "Sans serif" },
  { key: "serif", label: "Serif", stack: "'Iowan Old Style', Palatino, Charter, Georgia, serif", group: "Serif" },
  { key: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif", group: "Serif" },
  { key: "palatino", label: "Palatino", stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif", group: "Serif" },
  { key: "times", label: "Times", stack: "'Times New Roman', Times, serif", group: "Serif" },
  { key: "garamond", label: "Garamond", stack: "Garamond, 'Apple Garamond', 'EB Garamond', serif", group: "Serif" },
  { key: "baskerville", label: "Baskerville", stack: "Baskerville, 'Baskerville Old Face', Georgia, serif", group: "Serif" },
  { key: "bookman", label: "Bookman", stack: "'Bookman Old Style', 'URW Bookman', Georgia, serif", group: "Serif" },
  { key: "mono", label: "Mono", stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", group: "Mono" },
  { key: "courier", label: "Courier", stack: "'Courier New', Courier, monospace", group: "Mono" },
] as const;

/** Key → stack; an unknown or legacy key falls back to the default face ("" = inherit). */
export function docFontStack(key: string | undefined): string {
  if (!key) return "";
  return DOC_FONTS.find((f) => f.key === key)?.stack ?? "";
}
