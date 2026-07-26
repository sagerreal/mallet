import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";
import { logger } from "@mallet/shared/observability";
import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import type {
  QboAccess,
  QboApiGateway,
  QboCustomer,
  QboPerson,
  QboPreflight,
  QboServiceItem,
  QboTimeActivityInput,
} from "../domain/qbo-api-gateway";
import type { QboCustomerInput } from "../domain/customer-mapping";

// The ONLY file that speaks the QuickBooks Accounting API. OAuth lives in http-qbo-oauth-gateway.
//
// minorversion is PINNED: versions 1-74 were retired on 2025-08-01, and omitting it drops you onto
// the 2014 schema. Bumping this is a deliberate, tested change, never incidental.
const MINOR_VERSION = "75";

const HOSTS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
} as const;

export type QboEnvironment = keyof typeof HOSTS;

const isRetriableStatus = (status: number): boolean => status >= 500 || status === 429;

// QBO wraps single results and omits the array entirely when a query matches nothing — so `?? []`
// is load-bearing, not defensive noise.
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export class HttpQboApiGateway implements QboApiGateway {
  private readonly breaker = new CircuitBreaker("quickbooks-api", {
    failureThreshold: 5,
    resetMs: 30_000,
  });

  constructor(
    private readonly environment: QboEnvironment,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private base(realmId: string): string {
    return `${HOSTS[this.environment]}/v3/company/${realmId}`;
  }

  private async request<T>(
    access: QboAccess,
    path: string,
    init: RequestInit & { idempotent: boolean },
    what: string,
  ): Promise<Result<T, AppError>> {
    const url = `${this.base(access.realmId)}${path}${path.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`;
    try {
      const res = await call(
        (signal) =>
          this.fetchImpl(url, {
            ...init,
            headers: {
              Authorization: `Bearer ${access.accessToken}`,
              Accept: "application/json",
              ...(init.body ? { "Content-Type": "application/json" } : {}),
              ...init.headers,
            },
            signal,
          }),
        {
          timeoutMs: 20_000,
          idempotent: init.idempotent,
          retries: init.idempotent ? 2 : 0,
          breaker: this.breaker,
          shouldRetry: (e) => e instanceof TimeoutError || e instanceof TypeError,
        },
      );

      if (!res.ok) {
        if (res.status === 401) {
          // The access token died mid-flight. Distinct from a permission problem: the caller should
          // refresh and retry rather than mark the connection broken.
          return err(unauthorized("QuickBooks rejected the access token"));
        }
        // The body can echo request contents, so it is logged (server-side) but never surfaced.
        const body = await res.text().catch(() => "");
        logger.warn({ what, status: res.status, body: body.slice(0, 500) }, "qbo.api.failed");
        return err(
          externalService(
            "quickbooks",
            `QuickBooks ${what} failed (HTTP ${res.status})`,
            isRetriableStatus(res.status),
          ),
        );
      }

      return ok((await res.json()) as T);
    } catch (error) {
      logger.warn(
        { what, err: error instanceof Error ? error.message : String(error) },
        "qbo.api.error",
      );
      return err(externalService("quickbooks", `QuickBooks ${what} failed`, true));
    }
  }

  private query<T>(access: QboAccess, sql: string, what: string): Promise<Result<T, AppError>> {
    return this.request<T>(
      access,
      `/query?query=${encodeURIComponent(sql)}`,
      { method: "GET", idempotent: true },
      what,
    );
  }

  async listPeople(access: QboAccess): Promise<Result<readonly QboPerson[], AppError>> {
    // Two queries rather than one: QBO's query language has no UNION.
    const employees = await this.query<{ QueryResponse?: { Employee?: unknown } }>(
      access,
      "select * from Employee where Active = true maxresults 1000",
      "employee list",
    );
    if (!employees.ok) return err(employees.error);

    // Vendors are fetched in full and filtered HERE, not in the query. `Vendor1099` is returned on
    // every vendor but is NOT a queryable property — QuickBooks answers
    // "QueryValidationError: property 'Vendor1099' is not queryable" with a 400 (verified against a
    // live company). So the filter has to happen client-side.
    const vendors = await this.query<{ QueryResponse?: { Vendor?: unknown } }>(
      access,
      "select * from Vendor where Active = true maxresults 1000",
      "vendor list",
    );
    if (!vendors.ok) return err(vendors.error);

    const people: QboPerson[] = [];

    for (const raw of asArray<Record<string, unknown>>(employees.value.QueryResponse?.Employee)) {
      const id = str(raw.Id);
      if (!id) continue;
      people.push({
        id,
        displayName: str(raw.DisplayName) ?? str(raw.GivenName) ?? `Employee ${id}`,
        kind: "Employee",
        // Intuit's "use time data to create paychecks" flag — the thing that decides whether an
        // employee's hours reach a paycheck.
        //
        // ABSENT IS NOT FALSE. Verified against a live company (2026-07-24): a company WITHOUT
        // payroll omits UseTimeEntry from every Employee record entirely. Reading that absence as
        // "off" made the UI warn about every single employee — the same mistake as the phantom
        // TimeTrackingEnabled field. undefined here means "QuickBooks didn't say", and the UI stays
        // quiet rather than raising an alarm it cannot substantiate.
        usesTimeForPaychecks:
          raw.UseTimeEntry === undefined || raw.UseTimeEntry === null
            ? undefined
            : raw.UseTimeEntry === "UseTimeEntryForTimeSheet" || raw.UseTimeEntry === true,
      });
    }

    for (const raw of asArray<Record<string, unknown>>(vendors.value.QueryResponse?.Vendor)) {
      const id = str(raw.Id);
      if (!id) continue;
      // ONLY 1099 subcontractors. A shop's vendor list is overwhelmingly suppliers, utilities and
      // insurers — the supply house, the phone company, the state treasury. Offering those as
      // "who is this person in QuickBooks?" makes the picker unusable (a live company returned 26
      // vendors, exactly 1 of them a 1099 contractor). Vendor1099 is QuickBooks' own flag for
      // someone who gets a 1099, which is precisely the population whose time we might record.
      if (raw.Vendor1099 !== true) continue;
      people.push({
        id,
        displayName: str(raw.DisplayName) ?? `Vendor ${id}`,
        kind: "Vendor",
      });
    }

    return ok(people);
  }

  async listServiceItems(access: QboAccess): Promise<Result<readonly QboServiceItem[], AppError>> {
    const res = await this.query<{ QueryResponse?: { Item?: unknown } }>(
      access,
      "select * from Item where Type = 'Service' and Active = true maxresults 1000",
      "service item list",
    );
    if (!res.ok) return err(res.error);

    const items: QboServiceItem[] = [];
    for (const raw of asArray<Record<string, unknown>>(res.value.QueryResponse?.Item)) {
      const id = str(raw.Id);
      const name = str(raw.Name);
      if (id && name) items.push({ id, name });
    }
    return ok(items);
  }

  async preflight(access: QboAccess): Promise<Result<QboPreflight, AppError>> {
    const res = await this.request<{ Preferences?: Record<string, Record<string, unknown>> }>(
      access,
      "/preferences",
      { method: "GET", idempotent: true },
      "preferences",
    );
    if (!res.ok) return err(res.error);

    const prefs = res.value.Preferences ?? {};
    const timeBlock = prefs.TimeTrackingPrefs as Record<string, unknown> | undefined;
    const time = timeBlock ?? {};
    const defaultItem = time.DefaultTimeItem as { value?: unknown } | undefined;

    return ok({
      // VERIFIED against a live company (2026-07-24): QuickBooks returns NO `TimeTrackingEnabled`
      // field. A real Essentials company with timesheets fully switched on returns only
      // { UseServices, DefaultTimeItem, BillCustomers, ShowBillRateToAll, WorkWeekStartDate,
      // MarkTimeEntriesBillable } — and the QBO UI has no master on/off toggle either, just those
      // sub-options. Checking a non-existent field made this read false for EVERY company and
      // raised a false alarm telling shops to switch on something already on.
      // The honest signal is whether the block exists at all: a plan without time tracking has no
      // TimeTrackingPrefs to return.
      timeTrackingEnabled: timeBlock !== undefined,
      defaultItemId: str(defaultItem?.value),
      companyName: str((prefs.CompanyInfo as Record<string, unknown> | undefined)?.CompanyName),
    });
  }

  async countTimeActivitySince(
    access: QboAccess,
    since: string,
  ): Promise<Result<number, AppError>> {
    const res = await this.query<{ QueryResponse?: { totalCount?: unknown } }>(
      access,
      `select count(*) from TimeActivity where TxnDate >= '${since}'`,
      "time activity count",
    );
    if (!res.ok) return err(res.error);
    const n = res.value.QueryResponse?.totalCount;
    return ok(typeof n === "number" ? n : 0);
  }

  async createTimeActivity(
    access: QboAccess,
    input: QboTimeActivityInput,
  ): Promise<Result<{ id: string }, AppError>> {
    const body: Record<string, unknown> = {
      TxnDate: input.txnDate,
      NameOf: input.personKind,
      [input.personKind === "Employee" ? "EmployeeRef" : "VendorRef"]: { value: input.personId },
      ItemRef: { value: input.itemId },
      Hours: input.hours,
      Minutes: input.minutes,
      Description: input.description,
      BillableStatus: input.billable ? "Billable" : "NotBillable",
    };

    // NOT idempotent — a retry would create a second entry. Duplicate protection is the
    // qbo_sync_log unique index, not a retry policy.
    const res = await this.request<{ TimeActivity?: { Id?: unknown } }>(
      access,
      "/timeactivity",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
      "time activity create",
    );
    if (!res.ok) return err(res.error);

    const id = str(res.value.TimeActivity?.Id);
    if (!id) {
      return err(externalService("quickbooks", "QuickBooks returned no id for the time entry", false));
    }
    return ok({ id });
  }

  /**
   * QuickBooks' query language is SQL-shaped and takes a single string, so a value carrying an
   * apostrophe — O'Brien Plumbing, a very ordinary customer name — would terminate the literal and
   * make the rest of the name parse as syntax. Doubling it is the escape QBO specifies.
   *
   * This is not only a correctness fix: the values here are customer-supplied, so an unescaped
   * interpolation is a query-injection seam into someone's accounting company.
   */
  private static quote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private async findOneCustomer(
    access: QboAccess,
    where: string,
    what: string,
  ): Promise<Result<QboCustomer | null, AppError>> {
    const res = await this.query<{ QueryResponse?: { Customer?: unknown } }>(
      access,
      `select Id, DisplayName from Customer where ${where} maxresults 2`,
      what,
    );
    if (!res.ok) return err(res.error);

    const rows = Array.isArray(res.value.QueryResponse?.Customer)
      ? (res.value.QueryResponse.Customer as Array<Record<string, unknown>>)
      : [];
    // No match is an ordinary answer, not a failure — the caller creates one.
    const first = rows[0];
    if (!first) return ok(null);
    const id = first.Id;
    const displayName = first.DisplayName;
    if (typeof id !== "string" || typeof displayName !== "string") {
      return err(externalService("quickbooks", "QuickBooks returned a customer we could not read", true));
    }
    return ok({ id, displayName });
  }

  async findCustomerByEmail(
    access: QboAccess,
    email: string,
  ): Promise<Result<QboCustomer | null, AppError>> {
    return this.findOneCustomer(
      access,
      `PrimaryEmailAddr = ${HttpQboApiGateway.quote(email)}`,
      "customer lookup by email",
    );
  }

  async findCustomerByName(
    access: QboAccess,
    displayName: string,
  ): Promise<Result<QboCustomer | null, AppError>> {
    return this.findOneCustomer(
      access,
      `DisplayName = ${HttpQboApiGateway.quote(displayName)}`,
      "customer lookup by name",
    );
  }

  async createCustomer(
    access: QboAccess,
    input: QboCustomerInput,
  ): Promise<Result<QboCustomer, AppError>> {
    const body: Record<string, unknown> = { DisplayName: input.displayName };
    if (input.email) body.PrimaryEmailAddr = { Address: input.email };
    if (input.phone) body.PrimaryPhone = { FreeFormNumber: input.phone };
    // One unparsed line — see toQboCustomer for why we do not invent a structured address.
    if (input.addressLine1) body.BillAddr = { Line1: input.addressLine1 };

    // NOT idempotent. The duplicate guard is DisplayName's uniqueness in QuickBooks plus the
    // caller's search-before-create; a retry here would be refused by QBO, not silently doubled.
    const res = await this.request<{ Customer?: { Id?: unknown; DisplayName?: unknown } }>(
      access,
      "/customer",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
      "customer create",
    );
    if (!res.ok) return err(res.error);

    const id = res.value.Customer?.Id;
    if (typeof id !== "string") {
      return err(externalService("quickbooks", "QuickBooks created a customer without an id", false));
    }
    const name = res.value.Customer?.DisplayName;
    return ok({ id, displayName: typeof name === "string" ? name : input.displayName });
  }

}
