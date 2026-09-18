import { asLeadId, asOrgId, asPhone, asCompanyId, money } from "@mallet/shared/types";
import { leads } from "@mallet/shared/db/schema";
import { Lead, isLeadStage } from "../domain/lead";

// The persistence row shape, inferred from the schema. Kept distinct from the domain type:
// the mapper is the only place that knows both.
export type LeadRow = typeof leads.$inferSelect;

// Reconstruct a domain Lead from a DB row. A row that fails domain invariants is corrupt data,
// not an expected condition — fail loud rather than silently coerce.
export const toDomain = (row: LeadRow): Lead => {
  if (!isLeadStage(row.stage)) {
    throw new Error(`corrupt lead ${row.id}: unknown stage "${row.stage}"`);
  }
  const result = Lead.create({
    id: asLeadId(row.id),
    orgId: asOrgId(row.orgId),
    name: row.name,
    phone: row.phoneE164 ? asPhone(row.phoneE164) : null,
    email: row.email,
    customFields: (row.customFields as { label: string; value: string }[] | null) ?? null,
    source: row.source,
    // NOT NULL DEFAULT '{}' in the column, so the coalesce is only for a row read back
    // through a partial select that did not ask for it.
    tags: row.tags ?? [],
    stage: row.stage,
    value: money(row.valueCents),
    unread: row.unread,
    wonAt: row.wonAt,
    companyId: row.companyId ? asCompanyId(row.companyId) : null,
    role: row.role,
    notes: row.notes ?? null,
    lossReason: row.lossReason ?? null,
    address: row.address ?? null,
    pipelineStageId: row.pipelineStageId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt lead ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
