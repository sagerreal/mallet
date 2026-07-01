import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { RelatedType } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";
import type { ReminderTargetReader } from "../domain/reminder-target-reader";
import type { FollowUpPolicy } from "../domain/follow-up-policy";

export interface DueReminder {
  readonly relatedType: RelatedType;
  readonly relatedId: string;
  readonly num: string;
  readonly stage: number;
}

// The query a future scheduler (Inngest cron) polls: open invoices whose next reminder stage is
// due now and not already sent. Pure read + compute, no side effects. Stages are batch-loaded to
// avoid N+1.
export class NextRemindersDueUseCase {
  constructor(
    private readonly reader: ReminderTargetReader,
    private readonly repo: NotificationRepository,
    private readonly policy: FollowUpPolicy,
  ) {}

  async exec(now: Date, page: CursorPage): Promise<Paginated<DueReminder>> {
    const targets = await this.reader.findOpenInvoiceTargets(page);
    const ids = targets.items.map((t) => t.id);
    const stagesById = ids.length
      ? await this.repo.sentReminderStages("invoice", ids)
      : new Map<string, number[]>();

    const items: DueReminder[] = [];
    for (const t of targets.items) {
      const stage = this.policy.nextReminderDue(t.status, t.sentAt, stagesById.get(t.id) ?? [], now);
      if (stage !== null) items.push({ relatedType: "invoice", relatedId: t.id, num: t.num, stage });
    }
    return { items, nextCursor: targets.nextCursor };
  }
}
