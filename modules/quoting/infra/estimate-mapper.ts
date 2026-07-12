import { asEstimateId, asEstimateLineId, asOrgId, asLeadId, money } from "@mallet/shared/types";
import { estimates, estimateLines } from "@mallet/shared/db/schema";
import { Estimate, EstimateLine, isEstimateStatus } from "../domain/estimate";

export type EstimateRow = typeof estimates.$inferSelect;
export type EstimateLineRow = typeof estimateLines.$inferSelect;

const toEstimateLine = (row: EstimateLineRow): EstimateLine => {
  const result = EstimateLine.create({
    id: asEstimateLineId(row.id),
    description: row.description,
    quantity: row.quantity,
    rate: money(row.rateCents),
    cost: money(row.costCents),
    isOptional: row.isOptional,
    needsPhoto: row.needsPhoto,
    position: row.position,
  });
  if (!result.ok) throw new Error(`corrupt estimate_line ${row.id}: ${result.error.message}`);
  return result.value;
};

// Reconstruct the aggregate from a header row + its (already deleted-filtered) line rows. Corrupt
// data fails loud rather than silently coercing.
export const toDomain = (row: EstimateRow, lineRows: readonly EstimateLineRow[]): Estimate => {
  if (!isEstimateStatus(row.status)) {
    throw new Error(`corrupt estimate ${row.id}: unknown status "${row.status}"`);
  }
  const lines = [...lineRows]
    .sort((a, b) => a.position - b.position)
    .map(toEstimateLine);

  const result = Estimate.create({
    id: asEstimateId(row.id),
    orgId: asOrgId(row.orgId),
    num: row.num,
    leadId: asLeadId(row.leadId),
    title: row.title,
    status: row.status,
    discBps: row.discBps,
    taxBps: row.taxBps,
    depBps: row.depBps,
    depPaid: money(row.depPaidCents),
    validDays: row.validDays,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    declineReason: row.declineReason,
    changeRequestedAt: row.changeRequestedAt,
    changeRequest: row.changeRequest,
    publicToken: row.publicToken,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt estimate ${row.id}: ${result.error.message}`);
  return result.value;
};
