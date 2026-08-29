import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { pricebookItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type ServiceId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Service, ServicePricedBy } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";
import { laborHoursToColumn, rowToService } from "./service-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleServiceRepository implements ServiceRepository {
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
    unitPriceCents: number;
    costCents: number;
    laborHours: number | null;
    taxable: boolean;
    warrantyText: string | null;
    imageUrl: string | null;
    isAddon: boolean;
    active: boolean;
    position: number;
    measuredBy: ServicePricedBy | null;
    unit?: string | null;
  }): Promise<Service> {
    const rows = await this.tx
      .insert(pricebookItems)
      .values({
        id: input.id,
        orgId: this.orgId,
        categoryId: input.categoryId,
        code: input.code,
        label: input.name,
        description: input.description,
        unitPriceCents: input.unitPriceCents,
        costCents: input.costCents,
        laborHours: laborHoursToColumn(input.laborHours),
        taxable: input.taxable,
        warrantyText: input.warrantyText,
        imageUrl: input.imageUrl,
        isAddon: input.isAddon,
        active: input.active,
        position: input.position,
        measuredBy: input.measuredBy,
        unit: input.unit ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("pricebook_item insert returned no row");
    return rowToService(row);
  }

  async findById(id: ServiceId): Promise<Service | null> {
    const rows = await this.tx
      .select()
      .from(pricebookItems)
      .where(
        and(
          eq(pricebookItems.orgId, this.orgId),
          eq(pricebookItems.id, id),
          isNull(pricebookItems.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToService(row) : null;
  }

  async allNames(): Promise<string[]> {
    const rows = await this.tx
      .select({ label: pricebookItems.label })
      .from(pricebookItems)
      .where(and(eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt)));
    return rows.map((r) => r.label);
  }

  async list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>> {
    const conds = [eq(pricebookItems.orgId, this.orgId), isNull(pricebookItems.deletedAt)];

    const search = filter.search?.trim();
    if (search) {
      // Uses pricebook_items_org_name_idx.
      conds.push(ilike(pricebookItems.label, `%${search}%`));
    }
    // undefined = no filter; a passed categoryId (string) filters to that category. Keep it
    // simple — literal `null` is treated the same as undefined (no "uncategorised only" mode).
    if (typeof filter.categoryId === "string") {
      conds.push(eq(pricebookItems.categoryId, filter.categoryId));
    }

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order — the ORDER
        // BY below must match this exactly (mirrors drizzle-company-repository.ts) or the keyset
        // comparison skips/duplicates rows across page boundaries. Display ordering by
        // (position, name) is a presentation concern the store/UI hydrator handles, not this repo.
        // Pass created_at as an ISO string, not a JS Date: postgres.js cannot bind a Date inside
        // a row-value tuple ("Received an instance of Date"). The ::timestamptz cast parses it.
        conds.push(
          sql`(${pricebookItems.createdAt}, ${pricebookItems.id}) < (${cursor.value.createdAt.toISOString()}::timestamptz, ${cursor.value.id}::uuid)`,
        );
      }
    }

    const rows = await this.tx
      .select()
      .from(pricebookItems)
      .where(and(...conds))
      .orderBy(desc(pricebookItems.createdAt), desc(pricebookItems.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(rowToService), page, (service) => ({
      createdAt: service.props.createdAt,
      id: service.props.id,
    }));
  }

  async save(service: Service): Promise<void> {
    const p = service.props;
    await this.tx
      .update(pricebookItems)
      .set({
        categoryId: p.categoryId,
        code: p.code,
        label: p.name,
        description: p.description,
        unitPriceCents: p.unitPriceCents,
        costCents: p.costCents,
        laborHours: laborHoursToColumn(p.laborHours),
        taxable: p.taxable,
        warrantyText: p.warrantyText,
        imageUrl: p.imageUrl,
        isAddon: p.isAddon,
        active: p.active,
        position: p.position,
        measuredBy: p.measuredBy,
        unit: p.unit,
        updatedAt: p.updatedAt,
      })
      // Guard: explicit org_id + non-deleted check (defense in depth alongside RLS).
      .where(
        and(
          eq(pricebookItems.id, p.id),
          eq(pricebookItems.orgId, this.orgId),
          isNull(pricebookItems.deletedAt),
        ),
      );
  }

  async archive(id: ServiceId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(pricebookItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(pricebookItems.id, id),
          eq(pricebookItems.orgId, this.orgId),
          isNull(pricebookItems.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }
}
