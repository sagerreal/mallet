import { describe, it, expect, vi } from "vitest";
import { HttpQboApiGateway } from "./http-qbo-api-gateway";

const ACCESS = { accessToken: "A", realmId: "913035" };
const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe("preflight — against the shape QuickBooks actually returns", () => {
  // Captured verbatim from a live sandbox company on 2026-07-24 with timesheets fully ON.
  // Note the ABSENCE of any TimeTrackingEnabled field — that absence caused a false alarm.
  const LIVE = {
    Preferences: {
      TimeTrackingPrefs: {
        UseServices: true,
        DefaultTimeItem: { value: "2" },
        BillCustomers: true,
        ShowBillRateToAll: false,
        WorkWeekStartDate: "Monday",
        MarkTimeEntriesBillable: true,
      },
    },
  };

  it("reports time tracking AVAILABLE for a real company that has it on", async () => {
    const g = new HttpQboApiGateway("sandbox", vi.fn().mockResolvedValue(res(LIVE)));
    const r = await g.preflight(ACCESS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timeTrackingEnabled).toBe(true);
  });

  it("picks up the company's own DefaultTimeItem", async () => {
    const g = new HttpQboApiGateway("sandbox", vi.fn().mockResolvedValue(res(LIVE)));
    const r = await g.preflight(ACCESS);
    if (r.ok) expect(r.value.defaultItemId).toBe("2");
  });

  it("reports UNAVAILABLE only when there is no TimeTrackingPrefs block at all", async () => {
    const g = new HttpQboApiGateway("sandbox", vi.fn().mockResolvedValue(res({ Preferences: {} })));
    const r = await g.preflight(ACCESS);
    if (r.ok) expect(r.value.timeTrackingEnabled).toBe(false);
  });
});

describe("listPeople — vendor filtering", () => {
  // Shapes captured from a live sandbox company on 2026-07-24.
  const reply = (employees: unknown[], vendors: unknown[]) => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(res({ QueryResponse: { Employee: employees } }))
      .mockResolvedValueOnce(res({ QueryResponse: { Vendor: vendors } }));
    return fetchMock;
  };

  const EMPLOYEES = [
    { Id: "55", DisplayName: "Emily Platt", UseTimeEntry: "UseTimeEntryForTimeSheet" },
    { Id: "56", DisplayName: "John Johnson" },
  ];
  const VENDORS = [
    { Id: "1", DisplayName: "PG&E", Vendor1099: false },
    { Id: "2", DisplayName: "United States Treasury", Vendor1099: false },
    { Id: "3", DisplayName: "Tony Rondonuwu", Vendor1099: true },
  ];

  it("keeps only 1099 vendors — suppliers and utilities are not people who work hours", async () => {
    const g = new HttpQboApiGateway("sandbox", reply(EMPLOYEES, VENDORS));
    const r = await g.listPeople(ACCESS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vendors = r.value.filter((p) => p.kind === "Vendor");
    expect(vendors.map((v) => v.displayName)).toEqual(["Tony Rondonuwu"]);
  });

  it("never filters Vendor1099 in the QUERY — QuickBooks 400s, it is not queryable", async () => {
    const fetchMock = reply(EMPLOYEES, VENDORS);
    await new HttpQboApiGateway("sandbox", fetchMock).listPeople(ACCESS);
    const vendorUrl = decodeURIComponent((fetchMock.mock.calls[1] as [string])[0]);
    expect(vendorUrl).not.toContain("Vendor1099");
  });

  it("keeps all employees", async () => {
    const g = new HttpQboApiGateway("sandbox", reply(EMPLOYEES, VENDORS));
    const r = await g.listPeople(ACCESS);
    if (r.ok) expect(r.value.filter((p) => p.kind === "Employee")).toHaveLength(2);
  });

  it("reports the pay-time flag as set when QuickBooks says so", async () => {
    const g = new HttpQboApiGateway("sandbox", reply(EMPLOYEES, []));
    const r = await g.listPeople(ACCESS);
    if (r.ok) expect(r.value.find((p) => p.id === "55")?.usesTimeForPaychecks).toBe(true);
  });

  it("reports it as UNKNOWN, not false, when the field is absent", async () => {
    // Verified live: a company without payroll omits UseTimeEntry from every Employee record.
    // Reading absence as "off" warned about every employee in the company.
    const g = new HttpQboApiGateway("sandbox", reply(EMPLOYEES, []));
    const r = await g.listPeople(ACCESS);
    if (r.ok) expect(r.value.find((p) => p.id === "56")?.usesTimeForPaychecks).toBeUndefined();
  });

  it("reports FALSE only when QuickBooks explicitly says not-set", async () => {
    const explicit = [{ Id: "57", DisplayName: "Dana", UseTimeEntry: "UseTimeEntryForPaychecks" }];
    const g = new HttpQboApiGateway("sandbox", reply(explicit, []));
    const r = await g.listPeople(ACCESS);
    if (r.ok) expect(r.value[0]?.usesTimeForPaychecks).toBe(false);
  });
});
