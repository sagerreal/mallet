// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseCsv } from "./parse-csv";

function fileOf(text: string): File {
  return new File([text], "customers.csv", { type: "text/csv" });
}

describe("parseCsv", () => {
  it("parses headers + records, trims, and handles quoted commas", async () => {
    const csv = `First Name,Phone,Address\nGary,(925) 555-0100,"1 Pine Rd, Apt 2"\n`;
    const out = await parseCsv(fileOf(csv));
    expect(out.headers).toEqual(["First Name", "Phone", "Address"]);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toEqual({ "First Name": "Gary", Phone: "(925) 555-0100", Address: "1 Pine Rd, Apt 2" });
  });

  it("drops fully-empty rows", async () => {
    const out = await parseCsv(fileOf(`Name\nGary\n\n,\n`));
    expect(out.records).toHaveLength(1);
  });

  it("backfills missing trailing columns as empty strings (ragged rows)", async () => {
    const out = await parseCsv(fileOf(`Name,Phone,Address\nGary,555-0100\n`));
    expect(out.records[0]).toEqual({ Name: "Gary", Phone: "555-0100", Address: "" });
  });
});
