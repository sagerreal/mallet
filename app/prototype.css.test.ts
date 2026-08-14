/**
 * app/prototype.css.test.ts
 *
 * A handful of rules carry behaviour that nothing else in the suite can see: jsdom does not
 * apply the stylesheet, and the visual net (E2E_VISUAL=1) needs a browser and a seeded org.
 * Rather than leave them unguarded, these tests assert the RULE itself — that the declaration
 * a specific defect turned on is still in the sheet.
 *
 * Only rules with a named user-visible failure belong here. This is not a place to restate CSS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/prototype.css"), "utf8");

/** The declarations of one rule, by exact selector — whitespace-insensitive. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector}{`);
  if (at === -1) return "";
  return css.slice(at + selector.length + 1, css.indexOf("}", at)).replace(/\s+/g, "");
}

describe("chat bubbles — an incoming photo is not a layout element", () => {
  it("aligns an incoming message's children to the start", () => {
    // `.msg` is a column flex box, so its default align-items:stretch pulled every child to the
    // width of the WIDEST one. On a team message that is the sender-name line, so the photo was
    // stretched to it and then cropped by object-fit:cover: the sender saw the whole picture and
    // the receiver saw a slice of it. `.msg.us` already set align-items; `.msg.them` set only
    // align-self, so only incoming photos were wrong.
    expect(ruleBody(".msg.them")).toContain("align-items:flex-start");
  });
});

describe("the command bar placeholder", () => {
  it("ellipsises rather than cutting a word in half", () => {
    // At 420px the placeholder rendered as "Ask Artie — or just say what you wan". A placeholder
    // is clipped, not ellipsised, by default; text-overflow has to be asked for, and Chrome and
    // Safari read it off the input while Firefox reads it off ::placeholder — hence both.
    expect(ruleBody(".cl-bar input")).toContain("text-overflow:ellipsis");
    expect(ruleBody(".cl-bar input::placeholder")).toContain("text-overflow:ellipsis");
  });
});
