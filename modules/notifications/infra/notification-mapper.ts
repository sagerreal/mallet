import { asOrgId } from "@mallet/shared/types";
import { notifications } from "@mallet/shared/db/schema";
import {
  Notification,
  isNotificationChannel,
  isNotificationStatus,
  type RelatedType,
} from "../domain/notification";

export type NotificationRow = typeof notifications.$inferSelect;

export const toDomain = (row: NotificationRow): Notification => {
  if (!isNotificationChannel(row.channel)) {
    throw new Error(`corrupt notification ${row.id}: unknown channel "${row.channel}"`);
  }
  if (!isNotificationStatus(row.status)) {
    throw new Error(`corrupt notification ${row.id}: unknown status "${row.status}"`);
  }
  let relatedType: RelatedType | null = null;
  let relatedId: string | null = null;
  if (row.relatedInvoiceId) {
    relatedType = "invoice";
    relatedId = row.relatedInvoiceId;
  } else if (row.relatedEstimateId) {
    relatedType = "estimate";
    relatedId = row.relatedEstimateId;
  }

  const result = Notification.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    channel: row.channel,
    to: row.toAddress,
    kind: row.kind,
    body: row.body,
    status: row.status,
    relatedType,
    relatedId,
    reminderStage: row.reminderStage,
    idempotencyKey: row.idempotencyKey,
    externalId: row.externalId,
    error: row.error,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  });
  if (!result.ok) throw new Error(`corrupt notification ${row.id}: ${result.error.message}`);
  return result.value;
};

// Column values for an INSERT — maps the domain's (relatedType, relatedId) to the two typed columns.
export const toInsertValues = (n: Notification) => {
  const p = n.props;
  return {
    id: p.id,
    orgId: p.orgId,
    channel: p.channel,
    toAddress: p.to,
    kind: p.kind,
    body: p.body,
    status: p.status,
    relatedInvoiceId: p.relatedType === "invoice" ? p.relatedId : null,
    relatedEstimateId: p.relatedType === "estimate" ? p.relatedId : null,
    reminderStage: p.reminderStage,
    idempotencyKey: p.idempotencyKey,
    externalId: p.externalId,
    error: p.error,
    sentAt: p.sentAt,
    createdAt: p.createdAt,
  };
};
