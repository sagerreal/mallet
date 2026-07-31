import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { pricebookMaterials } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type MaterialId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Material } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";
import { rowToMaterial } from "./material-mapper";

// shared/db/keyset.ts does not exist on this branch yet (PR #62, open, not merged) — inline the
// same fix here: pass createdAt as an ISO string, not a JS Date, because postgres.js cannot bind
// a Date inside a row-value tuple ("Received an instance of Date"). Swap for the shared
// `keysetBefore` helper once #62 lands.
const keysetBefore = (cursor: { createdAt: Date; id: string }) =>
  sql`(${pricebookMaterials.createdAt}, ${pricebookMaterials.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleMaterialRepository implements MaterialRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: string;
    orgId: string;
    categoryId: string | null;
    code: string | null;
    name: string;
    description: string | null;
    unitCostCents: number;
    unitPriceCents: number;
    pricingMode: "rule" | "manual";
    unitOfMeasure: string;
    markupBps: number | null;
    taxable: boolean;
    vendor: string | null;
    active: boolean;
    position: number;
  }): Promise<Material> {
    const rows = await this.tx
      .insert(pricebookMaterials)
      .values({
        id: input.id,
        orgId: this.orgId,
        categoryId: input.categoryId,
        code: input.code,
        name: input.name,
        description: input.description,
        unitCostCents: input.unitCostCents,
        unitPriceCents: input.unitPriceCents,
        pricingMode: input.pricingMode,
        unitOfMeasure: input.unitOfMeasure,
        markupBps: input.markupBps,
        taxable: input.taxable,
        vendor: input.vendor,
        active: input.active,
        position: input.position,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("pricebook_material insert returned no row");
    return rowToMaterial(row);
  }

  async findById(id: MaterialId): Promise<Material | null> {
    const rows = await this.tx
      .select()
      .from(pricebookMaterials)
      .where(
        and(
          eq(pricebookMaterials.orgId, this.orgId),
          eq(pricebookMaterials.id, id),
          isNull(pricebookMaterials.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToMaterial(row) : null;
  }

  async list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    const conds = [eq(pricebookMaterials.orgId, this.orgId), isNull(pricebookMaterials.deletedAt)];

    const search = filter.search?.trim();
    if (search) {
      // Uses pricebook_materials_org_name_idx.
      conds.push(ilike(pricebookMaterials.name, `%${search}%`));
    }
    // undefined = no filter; a passed categoryId (string) filters to that category. Keep it
    // simple — literal `null` is treated the same as undefined (no "uncategorised only" mode).
    if (typeof filter.categoryId === "string") {
      conds.push(eq(pricebookMaterials.categoryId, filter.categoryId));
    }

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order — the ORDER
        // BY below must match this exactly or the keyset comparison skips/duplicates rows across
        // page boundaries. Display ordering is a UI concern the store/hydrator handles, not
        // this repo.
        conds.push(keysetBefore(cursor.value));
      }
    }

    const rows = await this.tx
      .select()
      .from(pricebookMaterials)
      .where(and(...conds))
      .orderBy(desc(pricebookMaterials.createdAt), desc(pricebookMaterials.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(rowToMaterial), page, (material) => ({
      createdAt: material.props.createdAt,
      id: material.props.id,
    }));
  }

  async save(material: Material): Promise<void> {
    const p = material.props;
    await this.tx
      .update(pricebookMaterials)
      .set({
        categoryId: p.categoryId,
        code: p.code,
        name: p.name,
        description: p.description,
        unitCostCents: p.unitCostCents,
        unitPriceCents: p.unitPriceCents,
        pricingMode: p.pricingMode,
        unitOfMeasure: p.unitOfMeasure,
        markupBps: p.markupBps,
        taxable: p.taxable,
        vendor: p.vendor,
        active: p.active,
        position: p.position,
        updatedAt: p.updatedAt,
      })
      // Guard: explicit org_id + non-deleted check (defense in depth alongside RLS).
      .where(
        and(
          eq(pricebookMaterials.id, p.id),
          eq(pricebookMaterials.orgId, this.orgId),
          isNull(pricebookMaterials.deletedAt),
        ),
      );
  }

  async archive(id: MaterialId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(pricebookMaterials)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(pricebookMaterials.id, id),
          eq(pricebookMaterials.orgId, this.orgId),
          isNull(pricebookMaterials.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }
}
