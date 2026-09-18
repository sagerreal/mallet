/**
 * components/ui/label-association.test.ts
 *
 * A repo-wide guard: no `<label>` in the app may be unassociated with its control.
 *
 * This exists because **axe passes this defect**. Given
 * `<div class="field"><label>Phone</label><input placeholder="(925) 555-0123"></div>`
 * axe finds an accessible name — the placeholder — and reports green. So the a11y
 * gate cannot catch it, and 85 unassociated labels accumulated across 26 files
 * behind a passing net.
 *
 * A label counts as associated when it either
 *   1. carries `htmlFor` (or spreads `useFieldId`/`useGroupLabel`'s labelProps), or
 *   2. wraps its control, which associates implicitly.
 *
 * A bare sibling label is the defect: the control's name falls back to its
 * placeholder, which disappears the moment the user types, and tapping the label
 * does not focus the control — a free hit target lost, which matters most to the
 * person holding the phone in a wet glove.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/** Elements a `<label for>` can name. `datalist`/`div` deliberately excluded. */
const CONTROL =
  /<(input|select|textarea|Input|Select|Textarea|Field|FieldGroup|DurField|AddressInput|TagInput)\b/;

/**
 * Blank comments while preserving line numbers. Three "defects" in the first pass
 * of this scan were prose inside comments describing the very bug being fixed.
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => {
      const m = line.match(/(^|\s)\/\/(?!\/)/);
      if (!m || m.index === undefined) return line;
      const at = m.index + (m[1]?.length ?? 0);
      // Leave `https://` alone.
      if (at > 0 && line[at - 1] === ":") return line;
      return line.slice(0, at);
    })
    .join("\n");
}

interface Site {
  file: string;
  line: number;
  text: string;
}

function unassociatedLabels(): Site[] {
  const files = execSync(
    'grep -rl "<label" --include="*.tsx" components app features',
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((f) => f && !f.endsWith(".test.tsx"));

  const defects: Site[] = [];

  for (const rel of files) {
    const lines = stripComments(readFileSync(`${ROOT}/${rel}`, "utf8")).split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!/<label[\s>]/.test(lines[i]!)) continue;

      // Walk to the matching </label>, counting nested opens.
      let chunk = "";
      let depth = 0;
      for (let j = i; j < Math.min(lines.length, i + 200); j++) {
        chunk += lines[j] + "\n";
        depth += (lines[j]!.match(/<label[\s>]/g) ?? []).length;
        depth -= (lines[j]!.match(/<\/label>/g) ?? []).length;
        if (depth <= 0) break;
      }

      const gt = chunk.indexOf(">");
      const openTag = chunk.slice(0, gt + 1);

      // (1) explicit htmlFor, or a spread of the primitives that supply it.
      if (/htmlFor=/.test(openTag)) continue;
      if (/\{\.\.\.\w+\.labelProps\}/.test(openTag)) continue;
      // FieldGroup's own label names a role="group" via aria-labelledby.
      if (/\bid=\{labelId\}/.test(openTag)) continue;

      // (2) implicit association by wrapping the control.
      const inner = chunk.slice(gt + 1);
      const closeAt = inner.lastIndexOf("</label>");
      const body = closeAt === -1 ? inner : inner.slice(0, closeAt);
      if (CONTROL.test(body)) continue;

      defects.push({
        file: rel,
        line: i + 1,
        text: body.replace(/\s+/g, " ").trim().slice(0, 50),
      });
    }
  }

  return defects;
}

describe("every hand-rolled <label> is associated with its control", () => {
  it("finds no bare sibling labels anywhere in the app", () => {
    const defects = unassociatedLabels();
    const report = defects
      .map((d) => `  ${d.file}:${d.line}  "${d.text}"`)
      .join("\n");
    expect(
      defects,
      defects.length === 0
        ? ""
        : `${defects.length} unassociated <label>(s). Compose Field/FieldGroup, or ` +
            `pair with useFieldId/useGroupLabel — do not hand-roll htmlFor:\n${report}`,
    ).toEqual([]);
  });

  it("actually scans a meaningful number of files", () => {
    // Guards the guard: if the grep or the glob silently stops matching, the test
    // above passes vacuously. It found 50 files and 85 defects when written.
    const files = execSync(
      'grep -rl "<label" --include="*.tsx" components app features',
      { cwd: ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(30);
  });
});
