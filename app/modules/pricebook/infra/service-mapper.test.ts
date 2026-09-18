import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@mallet/shared/observability";
import { type ServiceRow, laborHoursToColumn, rowToService } from "./service-mapper";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const baseRow = (): ServiceRow => ({
  id: ROW_ID,
  orgId: ORG_ID,
  categoryId: null,
  code: null,
  label: "Water Heater Install",
  description: null,
  unitPriceCents: 129900,
  costCents: 45000,
  laborHours: "2.50",
  unit: null,
  defaultQuantity: null,
  taxable: true,
  warrantyText: null,
  imageUrl: null,
  isAddon: false,
  active: true,
  position: 0,
  measuredBy: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("rowToService (service mapper)", () => {
  it("maps a valid DB row to a Service, name <- label", () => {
    const service = rowToService(baseRow());
    const p = service.props;

    expect(p.name).toBe("Water Heater Install");
    expect(p.unitPriceCents).toBe(129900);
    expect(p.costCents).toBe(45000);
    expect(p.taxable).toBe(true);
    expect(p.active).toBe(true);
  });

  it("converts the numeric(5,2) labor_hours string to a number", () => {
    const service = rowToService(baseRow());
    expect(service.props.laborHours).toBe(2.5);
    expect(typeof service.props.laborHours).toBe("number");
  });

  it("passes through a null labor_hours as null (not NaN or 0)", () => {
    const row = baseRow();
    row.laborHours = null;
    const service = rowToService(row);
    expect(service.props.laborHours).toBeNull();
  });

  it("throws on a corrupt row (empty label violates the domain invariant)", () => {
    const row = baseRow();
    row.label = "";
    expect(() => rowToService(row)).toThrow(/corrupt pricebook_item/);
  });

  it("throws on a corrupt row (negative unit price violates the domain invariant)", () => {
    const row = baseRow();
    row.unitPriceCents = -1;
    expect(() => rowToService(row)).toThrow(/corrupt pricebook_item/);
  });

  it("passes through a null measured_by as null (flat price)", () => {
    const service = rowToService(baseRow());
    expect(service.props.measuredBy).toBeNull();
  });

  it("maps a valid measured_by value through unchanged", () => {
    const row = baseRow();
    row.measuredBy = "walls_sqft";
    expect(rowToService(row).props.measuredBy).toBe("walls_sqft");
  });

});

// THE OUTAGE THIS EXISTS TO PREVENT. The database is shared across every branch, and a branch that
// widens the measured_by CHECK applies that migration to it BEFORE its code is deployed. On 14 Aug
// a `soffit_sqft` row landed in Cedarline Painting's book while production still ran a build with
// no soffit in its set. rowToService threw, `pricebook.service.list` 500'd, and all seventeen
// services — the entire demo shop's pricebook, and with it every quote, invoice and Front Desk
// price for that org — became "Couldn't load your pricebook."
//
// An unrecognized measured_by is NOT corruption. It is a value written by a NEWER build against a
// constraint this one has not caught up to, and it is confined to one optional pricing hint on one
// row. Rejecting the whole aggregate over it — and with it the whole page — is out of all
// proportion to the damage. Strict on write (the DB CHECK and the zod input schema both still
// refuse an unknown value), tolerant on read.
/**
 * The placeholder here must be a unit this build will NEVER know. It was `soffit_sqft`, chosen
 * while that really was unknown — then #536 shipped soffits and made it a real MEASURED_BY_KIND,
 * so these tests began asserting that a supported unit gets dropped. Both branches were green in
 * isolation and main went red on the merge.
 *
 * `mystery_cubits` is not a unit anyone will add, which is the whole point: a stand-in for
 * "unknown" must not be a plausible future feature.
 */
const NEVER_A_UNIT = "mystery_cubits";

describe("rowToService — a measured_by this build has not heard of", () => {
  afterEach(() => vi.restoreAllMocks());

  it("still loads the service, so one unknown row cannot take down the whole book", () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const row = baseRow();
    row.measuredBy = NEVER_A_UNIT;

    const service = rowToService(row);

    expect(service.props.name).toBe("Water Heater Install");
    expect(service.props.unitPriceCents).toBe(129900);
  });

  it("drops the unit rather than guessing one — this build cannot price against it", () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const row = baseRow();
    row.measuredBy = NEVER_A_UNIT;

    expect(rowToService(row).props.measuredBy).toBeNull();
  });

  it("says so in the log — dropping a pricing unit is never silent", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const row = baseRow();
    row.measuredBy = NEVER_A_UNIT;

    rowToService(row);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain(NEVER_A_UNIT);
  });

  // The tolerance is scoped to this ONE column. A row that breaks a real invariant is still
  // corrupt and still stops the read, because there is no honest way to show it.
  it("does not make the mapper tolerant of anything else", () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const row = baseRow();
    row.measuredBy = NEVER_A_UNIT;
    row.unitPriceCents = -1;

    expect(() => rowToService(row)).toThrow(/corrupt pricebook_item/);
  });
});

describe("laborHoursToColumn (write-side conversion)", () => {
  it("stringifies a number for the numeric column", () => {
    expect(laborHoursToColumn(2.5)).toBe("2.5");
  });

  it("passes null through as null", () => {
    expect(laborHoursToColumn(null)).toBeNull();
  });

  it("round-trips through rowToService", () => {
    const row = baseRow();
    row.laborHours = laborHoursToColumn(1.75);
    expect(rowToService(row).props.laborHours).toBe(1.75);
  });
});
