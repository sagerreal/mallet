import { and, asc, eq, isNull } from "drizzle-orm";
import { pricebookCategories } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { CategoryId, OrgId } from "@mallet/shared/types";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";
import { rowToCategory } from "./category-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: string;
    orgId: string;
    parentId: string | null;
    name: string;
    sortOrder: number;
  }): Promise<Category> {
    const rows = await this.tx
      .insert(pricebookCategories)
      .values({
        id: input.id,
        orgId: this.orgId,
        parentId: input.parentId,
        name: input.name,
        sortOrder: input.sortOrder,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("pricebook_category insert returned no row");
    return rowToCategory(row);
  }

  // The full tree in one query, ordered for display — a shop's category tree is small enough
  // that pagination (and the N+1 of per-service category lookups) would be pure overhead.
  async list(): Promise<Category[]> {
    const rows = await this.tx
      .select()
      .from(pricebookCategories)
      .where(
        and(eq(pricebookCategories.orgId, this.orgId), isNull(pricebookCategories.deletedAt)),
      )
      .orderBy(asc(pricebookCategories.sortOrder), asc(pricebookCategories.name));
    return rows.map(rowToCategory);
  }

  async save(category: Category): Promise<void> {
    const p = category.props;
    await this.tx
      .update(pricebookCategories)
      .set({
        parentId: p.parentId,
        name: p.name,
        sortOrder: p.sortOrder,
        updatedAt: p.updatedAt,
      })
      // Guard: explicit org_id + non-deleted check (defense in depth alongside RLS).
      .where(
        and(
          eq(pricebookCategories.id, p.id),
          eq(pricebookCategories.orgId, this.orgId),
          isNull(pricebookCategories.deletedAt),
        ),
      );
  }

  async archive(id: CategoryId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(pricebookCategories)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(pricebookCategories.id, id),
          eq(pricebookCategories.orgId, this.orgId),
          isNull(pricebookCategories.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }
}
