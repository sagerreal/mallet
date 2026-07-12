import { describe, it, expect } from "vitest";
import { parserFor } from "./registry";
import { FormLeadParser } from "./form-parser";

describe("parserFor", () => {
  it("returns the form parser for the form channel", () => {
    expect(parserFor("form")).toBeInstanceOf(FormLeadParser);
  });
  it("returns null for channels not yet enabled (angi/thumbtack — PR B)", () => {
    // Guards the Open/Closed seam: PR B adds these by extending the PARSERS map, not this function.
    expect(parserFor("angi")).toBeNull();
    expect(parserFor("thumbtack")).toBeNull();
  });
});
