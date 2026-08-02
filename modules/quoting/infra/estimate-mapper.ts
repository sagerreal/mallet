import { asEstimateId, asEstimateLineId, asOrgId, asLeadId, money } from "@mallet/shared/types";
import { estimates, estimateLines } from "@mallet/shared/db/schema";
import { Estimate, EstimateLine, isEstimateStatus, isEstimateOrigin, type QuoteTier, type TierNames } from "../domain/estimate";
import type { SignedSnapshot } from "../domain/signature";

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
    // DB CHECK constrains the value set; EstimateLine.create re-validates and fails loud.
    tier: row.tier as QuoteTier | null,
    materialId: row.materialId ?? null,
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
  if (!isEstimateOrigin(row.origin)) {
    throw new Error(`corrupt estimate ${row.id}: unknown origin "${row.origin}"`);
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
    origin: row.origin,
    discBps: row.discBps,
    taxBps: row.taxBps,
    depBps: row.depBps,
    depPaid: money(row.depPaidCents),
    validDays: row.validDays,
    sentAt: row.sentAt,
    followUpOn: row.followUpOn,
    followUpStage: row.followUpStage,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    declineReason: row.declineReason,
    changeRequestedAt: row.changeRequestedAt,
    changeOrderForJobId: row.changeOrderForJobId,
    changeRequest: row.changeRequest,
    publicToken: row.publicToken,
    // Tier columns are DB CHECK-constrained; Estimate.create re-validates (incl. jsonb shape).
    recommendedTier: row.recommendedTier as QuoteTier | null,
    acceptedTier: row.acceptedTier as QuoteTier | null,
    tierNames: row.tierNames as TierNames | null,
    termsSnapshot: row.termsSnapshot,
    signerName: row.signerName,
    signatureSvg: row.signatureSvg,
    signerIp: row.signerIp,
    signerUserAgent: row.signerUserAgent,
    signedAt: row.signedAt,
    // jsonb comes back as unknown; the shape is ours on the way in, so this is a read-back cast
    // rather than untrusted input.
    signedSnapshot: (row.signedSnapshot as SignedSnapshot | null) ?? null,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt estimate ${row.id}: ${result.error.message}`);
  return result.value;
};
