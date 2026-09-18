import { describe, it, expect } from "vitest";
import { toolsForRole } from "./tool-filter";

const meta = (name: string, mutating: boolean) => ({
  name, description: "d", inputSchema: {}, mutating,
});

describe("toolsForRole", () => {
  const catalog = [meta("customer_list", false), meta("invoice_send", true), meta("job_cancel", true)];

  it("gives an owner the whole catalog", () => {
    expect(toolsForRole(catalog, "owner").map((t) => t.name)).toEqual([
      "customer_list", "invoice_send", "job_cancel",
    ]);
  });

  it("gives office the whole catalog", () => {
    expect(toolsForRole(catalog, "office")).toHaveLength(3);
  });

  it("gives a tech reads only — never a write", () => {
    const forTech = toolsForRole(catalog, "tech");
    expect(forTech.map((t) => t.name)).toEqual(["customer_list"]);
    expect(forTech.some((t) => t.mutating)).toBe(false);
  });

  it("returns a new array and never mutates the catalog", () => {
    const before = catalog.length;
    toolsForRole(catalog, "tech");
    expect(catalog).toHaveLength(before);
  });
});
