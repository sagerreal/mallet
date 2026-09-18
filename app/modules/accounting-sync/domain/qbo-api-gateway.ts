import type { Result, AppError } from "@mallet/shared/types";
import type { QboCustomerInput } from "./customer-mapping";
import type { QboInvoiceInput } from "./invoice-mapping";
import type { QboPaymentInput } from "./payment-mapping";

/** A QuickBooks person we can attribute time to. Employees and Vendors (1099 subs) both qualify. */
export interface QboPerson {
  readonly id: string;
  readonly displayName: string;
  /** Which ref TimeActivity must use for this person. */
  readonly kind: "Employee" | "Vendor";
  /**
   * Employees only. QuickBooks will not carry time into payroll for a person whose "use time data
   * to create paychecks" flag is off, so the mapping screen surfaces it rather than letting hours
   * land somewhere that quietly never reaches a paycheck.
   */
  readonly usesTimeForPaychecks?: boolean;
}

/** A QuickBooks customer, as much of one as we need to link and display. */
export interface QboCustomer {
  readonly id: string;
  readonly displayName: string;
}

/** A QuickBooks service item — the mandatory ItemRef on every TimeActivity. */
export interface QboServiceItem {
  readonly id: string;
  readonly name: string;
}

/** The company-level answers we need before we dare push anything. */
export interface QboPreflight {
  readonly timeTrackingEnabled: boolean;
  /** The company's own default time item, if set — a sensible pre-selection for our picker. */
  readonly defaultItemId: string | null;
  readonly companyName: string | null;
}

/** One time entry to create. Hours+Minutes rather than Start/End — see toTimeActivity. */
export interface QboTimeActivityInput {
  readonly txnDate: string; // YYYY-MM-DD
  readonly personId: string;
  readonly personKind: "Employee" | "Vendor";
  readonly itemId: string;
  readonly hours: number;
  readonly minutes: number;
  readonly description: string;
  readonly billable: boolean;
}

export interface QboApiGateway {
  /** Employees + Vendors, for the crew-matching screen. */
  listPeople(access: QboAccess): Promise<Result<readonly QboPerson[], AppError>>;
  listServiceItems(access: QboAccess): Promise<Result<readonly QboServiceItem[], AppError>>;
  preflight(access: QboAccess): Promise<Result<QboPreflight, AppError>>;
  /**
   * How many TimeActivity records already exist since `since`. Used once, at setup, to warn a shop
   * whose crew already clocks in inside QuickBooks — pushing ours too would pay the same hours
   * twice.
   */
  countTimeActivitySince(access: QboAccess, since: string): Promise<Result<number, AppError>>;
  createTimeActivity(
    access: QboAccess,
    input: QboTimeActivityInput,
  ): Promise<Result<{ id: string }, AppError>>;

  /**
   * Find one customer by an exact email or an exact DisplayName. Null when there is no match.
   *
   * Exact only, and never fuzzy: a near-match filed against the wrong customer puts one shop's
   * money on another's account, and nothing downstream would ever notice.
   */
  findCustomerByEmail(access: QboAccess, email: string): Promise<Result<QboCustomer | null, AppError>>;
  findCustomerByName(access: QboAccess, displayName: string): Promise<Result<QboCustomer | null, AppError>>;
  createCustomer(access: QboAccess, input: QboCustomerInput): Promise<Result<QboCustomer, AppError>>;

  /** Create an invoice. Not idempotent — the duplicate guard is the sync log, not a retry policy. */
  createInvoice(access: QboAccess, input: QboInvoiceInput): Promise<Result<{ id: string }, AppError>>;

  /** Create a payment LINKED to an invoice. Not idempotent — the sync log is the duplicate guard. */
  createPayment(access: QboAccess, input: QboPaymentInput): Promise<Result<{ id: string }, AppError>>;

  /**
   * The current SyncToken for an invoice, or null when QuickBooks no longer has it.
   *
   * QuickBooks uses SyncToken for optimistic concurrency: every update and void must present the
   * CURRENT one, and a stale token is refused. So it has to be read immediately before writing —
   * it cannot be cached, because a change made inside QuickBooks would invalidate it.
   */
  readInvoiceToken(access: QboAccess, qboId: string): Promise<Result<string | null, AppError>>;

  /** Replace a QuickBooks invoice's amount, tax and dates with Mallet's current ones. */
  updateInvoice(
    access: QboAccess,
    qboId: string,
    syncToken: string,
    input: QboInvoiceInput,
  ): Promise<Result<void, AppError>>;

  /** Void — never delete. Mallet is soft-delete-only and the books must be too. */
  voidInvoice(access: QboAccess, qboId: string, syncToken: string): Promise<Result<void, AppError>>;
}

/** A usable access token plus the company it belongs to. Produced by EnsureFreshAccessToken. */
export interface QboAccess {
  readonly accessToken: string;
  readonly realmId: string;
}
