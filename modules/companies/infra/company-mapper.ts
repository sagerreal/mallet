import { asCompanyId, asOrgId } from "@mallet/shared/types";
import { companies } from "@mallet/shared/db/schema";
import { Company } from "../domain/company";

// The persistence row shape, inferred from the schema.
export type CompanyRow = typeof companies.$inferSelect;

// Reconstruct a domain Company from a DB row. Corrupt data throws rather than silently coercing.
export const toDomain = (row: CompanyRow): Company => {
  const result = Company.create({
    id: asCompanyId(row.id),
    orgId: asOrgId(row.orgId),
    name: row.name,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt company ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
