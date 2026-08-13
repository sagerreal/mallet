/**
 * The jobs-import INPUT SCHEMA, tested against what the browser actually sends.
 *
 * This exists because of a real failure: the schema declared every field `.nullable()` without
 * `.optional()`, so it required the KEY to be present. But buildRows omits fields whose column the
 * sheet does not have — so a perfectly ordinary CSV (Customer, Service, Date and nothing else) was
 * rejected wholesale at the boundary with a wall of Zod errors, after the confirm step had already
 * promised "3 will import".
 *
 * The unit tests all passed: they exercised buildRows and the use-case, never the seam between
 * them. These close that seam.
 */

import { describe, it, expect } from "vitest";
import { autoMap } from "@/lib/import/engine/auto-map";
import { buildRows } from "@/lib/import/engine/build-rows";
import { JOB_IMPORT } from "@/lib/import/engine/descriptors";
import { importJobRowInput } from "./import-jobs-input";

/** What the modal sends: parse a CSV, map it, build rows — exactly as the browser does. */
const rowsFor = (headers: string[], records: Record<string, string>[]) =>
  buildRows(records, autoMap(headers, JOB_IMPORT), JOB_IMPORT).rows;

describe("importJobRowInput accepts what the importer actually builds", () => {
  it("takes a minimal sheet — customer, service and date only", () => {
    const headers = ["Customer", "Service", "Date"];
    const [row] = rowsFor(headers, [
      { Customer: "Gary Pratt", Service: "Water heater swap", Date: "08/20/2026" },
    ]);

    // The regression: `scope`, `addr`, `phone`, `status` and `scheduledStart` keys are ABSENT
    // here, because the sheet has no such columns.
    expect("scope" in row!).toBe(false);
    expect("addr" in row!).toBe(false);

    const parsed = importJobRowInput.safeParse(row);
    expect(parsed.success).toBe(true);
  });

  it("takes a sheet with every column mapped", () => {
    const headers = ["Customer", "Phone", "Service", "Description", "Address", "Date", "Time", "Status"];
    const [row] = rowsFor(headers, [
      {
        Customer: "Gary Pratt", Phone: "(925) 555-0100", Service: "Water heater swap",
        Description: "50 gal", Address: "1 Pine Rd", Date: "08/20/2026",
        Time: "2:30 PM", Status: "scheduled",
      },
    ]);

    expect(importJobRowInput.safeParse(row).success).toBe(true);
  });

  it("takes a mapped column left blank, which arrives as an explicit null", () => {
    const headers = ["Customer", "Service", "Description"];
    const [row] = rowsFor(headers, [
      { Customer: "Gary Pratt", Service: "Water heater swap", Description: "" },
    ]);

    // Mapped-but-blank is different from absent: the key is present and null.
    expect("scope" in row!).toBe(true);
    expect(row!.scope).toBeNull();
    expect(importJobRowInput.safeParse(row).success).toBe(true);
  });

  it("takes a row with no date at all — the job imports unscheduled", () => {
    const headers = ["Customer", "Service"];
    const [row] = rowsFor(headers, [{ Customer: "Gary Pratt", Service: "Faucet repair" }]);

    expect(importJobRowInput.safeParse(row).success).toBe(true);
  });

  it("still rejects a row with no customer, which is the one required field", () => {
    expect(importJobRowInput.safeParse({ svc: "Water heater swap" }).success).toBe(false);
  });

  it("still rejects a malformed date rather than passing it through", () => {
    const parsed = importJobRowInput.safeParse({ customer: "Gary Pratt", scheduledDate: "20/08/2026" });
    expect(parsed.success).toBe(false);
  });
});
