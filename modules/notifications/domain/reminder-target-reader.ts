import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { RelatedType } from "./notification";

// A thing a reminder can be about (an invoice or estimate), flattened with the contact + timing a
// reminder needs. A narrow read seam over invoicing/quoting data (read from the shared schema,
// RLS-scoped) so notifications never depends on those modules' internals.
export interface ReminderTarget {
  readonly type: RelatedType;
  readonly id: string;
  readonly num: string;
  readonly status: string; // the target's own status (sent/partial/paid/accepted/...)
  readonly sentAt: Date | null;
  readonly phone: string | null; // lead contact
  readonly email: string | null;
  readonly balanceCents: number; // invoice balance due (0 for estimates)
  readonly createdAt: Date; // for keyset pagination
}

export interface ReminderTargetReader {
  findTarget(type: RelatedType, id: string): Promise<ReminderTarget | null>;
  // Open invoices eligible for reminders (status sent|partial), newest-first, keyset-paginated.
  findOpenInvoiceTargets(page: CursorPage): Promise<Paginated<ReminderTarget>>;
}
