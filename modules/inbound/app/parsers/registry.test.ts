import { describe, it, expect } from "vitest";
import { parserFor } from "./registry";
import { FormLeadParser } from "./form-parser";
import { AngiLeadParser } from "./angi-parser";
import { ThumbtackLeadParser } from "./thumbtack-parser";

describe("parserFor", () => {
  it("returns a parser for every live channel", () => {
    expect(parserFor("form")).toBeInstanceOf(FormLeadParser);
    expect(parserFor("angi")).toBeInstanceOf(AngiLeadParser);
    expect(parserFor("thumbtack")).toBeInstanceOf(ThumbtackLeadParser);
  });
});
