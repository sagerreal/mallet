import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { companies } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type CompanyId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Company } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";
import { toDomain } from "./company-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleCompanyRepository implements CompanyRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: string;
    orgId: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    notes: string | null;
  }): Promise<Company> {
    const rows = await this.tx
      .insert(companies)
      .values({
        id: input.id,
        orgId: this.orgId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        website: input.website,
        address: input.address,
        notes: input.notes,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("company insert returned no row");
    return toDomain(row);
  }

  async findById(id: CompanyId): Promise<Company | null> {
    const rows = await this.tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async list(page: CursorPage): Promise<Paginated<Company>> {
    const conds = [eq(companies.orgId, this.orgId), isNull(companies.deletedAt)];

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order.
        conds.push(
          sql`(${companies.createdAt}, ${companies.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
        );
      }
    }

    const rows = await this.tx
      .select()
      .from(companies)
      .where(and(...conds))
      .orderBy(desc(companies.createdAt), desc(companies.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(toDomain), page, (company) => ({
      createdAt: company.props.createdAt,
      id: company.props.id,
    }));
  }

  async save(company: Company): Promise<void> {
    const p = company.props;
    await this.tx
      .update(companies)
      .set({
        name: p.name,
        phone: p.phone,
        email: p.email,
        website: p.website,
        address: p.address,
        notes: p.notes,
        updatedAt: p.updatedAt,
      })
      // Guard: explicit org_id + non-deleted check (defense in depth alongside RLS).
      .where(and(eq(companies.id, p.id), eq(companies.orgId, this.orgId), isNull(companies.deletedAt)));
  }

  async archive(id: CompanyId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(companies)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(companies.id, id), eq(companies.orgId, this.orgId), isNull(companies.deletedAt)))
      .returning();
    return rows.length;
  }
}
