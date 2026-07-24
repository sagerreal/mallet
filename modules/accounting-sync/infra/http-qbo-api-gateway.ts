import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";
import { logger } from "@mallet/shared/observability";
import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import type {
  QboAccess,
  QboApiGateway,
  QboPerson,
  QboPreflight,
  QboServiceItem,
  QboTimeActivityInput,
} from "../domain/qbo-api-gateway";

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
        // Intuit's flag for "use time data to create paychecks". Its absence is meaningful (older
        // records omit it), so treat only an explicit enable as true.
        usesTimeForPaychecks: raw.UseTimeEntry === "UseTimeEntryForTimeSheet" || raw.UseTimeEntry === true,
      });
    }

    for (const raw of asArray<Record<string, unknown>>(vendors.value.QueryResponse?.Vendor)) {
      const id = str(raw.Id);
      if (!id) continue;
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
    const time = (prefs.TimeTrackingPrefs ?? {}) as Record<string, unknown>;
    const defaultItem = time.DefaultTimeItem as { value?: unknown } | undefined;

    return ok({
      // Absent reads as OFF. Better to tell a shop to switch time tracking on than to push entries
      // into a company that silently discards them.
      timeTrackingEnabled: time.TimeTrackingEnabled === true,
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
}
