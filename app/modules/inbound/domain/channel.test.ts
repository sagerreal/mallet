import { describe, it, expect } from "vitest";
import { isChannel, CHANNELS } from "./channel";
describe("channel", () => {
  it("guards known channels", () => {
    expect(isChannel("form")).toBe(true);
    expect(isChannel("angi")).toBe(true);
    expect(isChannel("nope")).toBe(false);
  });
  it("CHANNELS lists exactly form/angi/thumbtack", () => {
    expect([...CHANNELS].sort()).toEqual(["angi", "form", "thumbtack"]);
  });
});
