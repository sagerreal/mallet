import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { checklistTemplates, checklistItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type ChecklistId,
  type ChecklistItemId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Checklist, ChecklistStage, ChecklistItemType } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";
import { toDomain, type ChecklistItemRow } from "./checklist-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and guard explicit-tenant writes.
export class DrizzleChecklistRepository implements ChecklistRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: ChecklistId;
    orgId: OrgId;
    name: string;
    trade: string;
    stage: ChecklistStage;
    match: readonly string[];
    items?: readonly {
      id: ChecklistItemId;
      text: string;
      type: ChecklistItemType;
      required: boolean;
      position: number;
    }[];
  }): Promise<Checklist> {
    const rows = await this.tx
      .insert(checklistTemplates)
      .values({
        id: input.id,
        orgId: this.orgId,
        name: input.name,
        trade: input.trade,
        stage: input.stage,
        match: [...input.match],
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("checklist insert returned no row");

    // Initial items ride the same tx — ONE bulk insert, atomic with the header.
    let itemRows: ChecklistItemRow[] = [];
    if (input.items && input.items.length > 0) {
      itemRows = await this.tx
        .insert(checklistItems)
        .values(
          input.items.map((it) => ({
            id: it.id,
            orgId: this.orgId,
            templateId: input.id,
            text: it.text,
            type: it.type,
            required: it.required,
            position: it.position,
          })),
        )
        .returning();
    }
    return toDomain(row, itemRows);
  }

  async findById(id: ChecklistId): Promise<Checklist | null> {
    const rows = await this.tx
      .select()
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.id, id),
          eq(checklistTemplates.orgId, this.orgId),
          isNull(checklistTemplates.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const itemRows = await this.loadItems([id]);
    return toDomain(row, itemRows);
  }

  async list(page: CursorPage): Promise<Paginated<Checklist>> {
    const conds = [eq(checklistTemplates.orgId, this.orgId), isNull(checklistTemplates.deletedAt)];

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order.
        conds.push(keysetBefore(checklistTemplates.createdAt, checklistTemplates.id, cursor.value));
      }
    }

    const rows = await this.tx
      .select()
      .from(checklistTemplates)
      .where(and(...conds))
      .orderBy(desc(checklistTemplates.createdAt), desc(checklistTemplates.id))
      .limit(page.limit + 1);

    // Batch-load items for the page in ONE query (no N+1).
    const ids = rows.map((r) => r.id);
    const itemRows = ids.length ? await this.loadItems(ids) : [];
    const byTemplate = new Map<string, ChecklistItemRow[]>();
    for (const it of itemRows) {
      const arr = byTemplate.get(it.templateId) ?? [];
      arr.push(it);
      byTemplate.set(it.templateId, arr);
    }

    const domain = rows.map((r) => toDomain(r, byTemplate.get(r.id) ?? []));
    return buildPage(domain, page, (chk) => ({
      createdAt: chk.props.createdAt,
      id: chk.props.id,
    }));
  }

  async archive(id: ChecklistId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(checklistTemplates)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(checklistTemplates.id, id),
          eq(checklistTemplates.orgId, this.orgId),
          isNull(checklistTemplates.deletedAt),
        ),
      )
      .returning();
    if (rows.length === 0) return 0;
    // Cascade soft-delete the items so a restored template does not resurrect stale items.
    await this.tx
      .update(checklistItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(checklistItems.templateId, id),
          eq(checklistItems.orgId, this.orgId),
          isNull(checklistItems.deletedAt),
        ),
      );
    return rows.length;
  }

  async addItem(input: {
    id: ChecklistItemId;
    templateId: ChecklistId;
    text: string;
    type: ChecklistItemType;
    required: boolean;
    position: number;
  }): Promise<Checklist> {
    await this.tx.insert(checklistItems).values({
      id: input.id,
      orgId: this.orgId,
      templateId: input.templateId,
      text: input.text,
      type: input.type,
      required: input.required,
      position: input.position,
    });
    const reloaded = await this.findById(input.templateId);
    if (!reloaded) throw new Error("checklist disappeared after addItem");
    return reloaded;
  }

  async removeItem(templateId: ChecklistId, itemId: ChecklistItemId, now: Date): Promise<Checklist | null> {
    await this.tx
      .update(checklistItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(checklistItems.id, itemId),
          eq(checklistItems.templateId, templateId),
          eq(checklistItems.orgId, this.orgId),
          isNull(checklistItems.deletedAt),
        ),
      );
    return this.findById(templateId);
  }

  async setItemRequired(
    templateId: ChecklistId,
    itemId: ChecklistItemId,
    required: boolean,
    now: Date,
  ): Promise<Checklist | null> {
    await this.tx
      .update(checklistItems)
      .set({ required, updatedAt: now })
      .where(
        and(
          eq(checklistItems.id, itemId),
          eq(checklistItems.templateId, templateId),
          eq(checklistItems.orgId, this.orgId),
          isNull(checklistItems.deletedAt),
        ),
      );
    return this.findById(templateId);
  }

  // Batch-load non-deleted items for the given template ids. One DB round-trip regardless
  // of page size — avoids N+1 per the design principles.
  private async loadItems(templateIds: readonly string[]): Promise<ChecklistItemRow[]> {
    return this.tx
      .select()
      .from(checklistItems)
      .where(
        and(
          inArray(checklistItems.templateId, [...templateIds]),
          eq(checklistItems.orgId, this.orgId),
          isNull(checklistItems.deletedAt),
        ),
      );
  }
}
