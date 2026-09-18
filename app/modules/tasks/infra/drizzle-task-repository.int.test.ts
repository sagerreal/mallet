import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asLeadId, asTaskId, toPage } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleTaskRepository } from "./drizzle-task-repository";

// Live RLS integration: the app role (NOBYPASSRLS) goes through the real DrizzleTaskRepository
// inside withTenant against the real Supabase DB. Proves keyset paging, soft-delete, and — most
// importantly — that one tenant physically cannot read another's tasks.
// Skipped when DB credentials are absent.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleTaskRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TaskRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TaskRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Lead for task test') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("creates a task and reads it back", async () => {
    const orgA = asOrgId(orgAId);
    const task = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      return repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        leadId: null,
        text: "Follow up call",
        dueDate: "2026-07-15",
      });
    });
    expect(task.props.text).toBe("Follow up call");
    expect(task.props.done).toBe(false);
    expect(task.props.dueDate).toBe("2026-07-15");
  });

  it("creates a task linked to a lead", async () => {
    const orgA = asOrgId(orgAId);
    const task = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      return repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        leadId: leadAId,
        text: "Send quote",
        dueDate: null,
      });
    });
    expect(task.props.leadId).toBe(leadAId);
    expect(task.props.dueDate).toBeNull();
  });

  it("findById returns null for a random id", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      return repo.findById(asTaskId(crypto.randomUUID()));
    });
    expect(result).toBeNull();
  });

  it("save persists done=true", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      const created = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        leadId: null,
        text: "Mark me done",
        dueDate: null,
      });
      const updated = created.setDone(true, new Date());
      await repo.save(updated);
      return repo.findById(created.props.id);
    });
    expect(result?.props.done).toBe(true);
  });

  it("remove soft-deletes and findById returns null afterwards", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      const created = await repo.create({
        id: crypto.randomUUID(),
        orgId: orgAId,
        leadId: null,
        text: "Remove me",
        dueDate: null,
      });
      const count = await repo.remove(created.props.id, new Date());
      const after = await repo.findById(created.props.id);
      return { count, after };
    });
    expect(result.count).toBe(1);
    expect(result.after).toBeNull();
  });

  it("cannot read another org's task — by id or in list", async () => {
    // Insert a task directly as admin under org B.
    const [taskRow] = await admin<{ id: string }[]>`
      insert into tasks (org_id, text, done)
      values (${orgBId}, 'Foreign task', false) returning id`;
    const foreignTaskId = taskRow!.id;

    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      const byId = await repo.findById(asTaskId(foreignTaskId));
      const listed = await repo.list(toPage({ limit: 100 }));
      return { byId, texts: listed.items.map((t) => t.props.text) };
    });

    expect(result.byId).toBeNull();
    expect(result.texts).not.toContain("Foreign task");
  });

  it("cannot insert a task stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleTaskRepository(tx, asOrgId(orgBId));
        await repo.create({
          id: crypto.randomUUID(),
          orgId: orgBId,
          leadId: null,
          text: "Mallory",
          dueDate: null,
        });
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("keyset paging: no skips or dupes across page boundary with mixed dueDates (incl. null)", async () => {
    const orgA = asOrgId(orgAId);
    // Create 5 tasks:
    //   - t1, t2: dueDate = "2026-08-01" (same day, different createdAt)
    //   - t3: dueDate = "2026-08-02"
    //   - t4, t5: dueDate = null (NULLS LAST)
    // With pageSize=2, page1 should have [t1, t2] and page2 [t3, ...], no skips/dupes.
    const prefix = `cursor-test-${crypto.randomUUID().slice(0, 8)}-`;
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleTaskRepository(tx, orgA);
      await repo.create({ id: crypto.randomUUID(), orgId: orgAId, leadId: null, text: `${prefix}t1`, dueDate: "2026-08-01" });
      await repo.create({ id: crypto.randomUUID(), orgId: orgAId, leadId: null, text: `${prefix}t2`, dueDate: "2026-08-01" });
      await repo.create({ id: crypto.randomUUID(), orgId: orgAId, leadId: null, text: `${prefix}t3`, dueDate: "2026-08-02" });
      await repo.create({ id: crypto.randomUUID(), orgId: orgAId, leadId: null, text: `${prefix}t4`, dueDate: null });
      await repo.create({ id: crypto.randomUUID(), orgId: orgAId, leadId: null, text: `${prefix}t5`, dueDate: null });
    });

    // Paginate with limit=2 — collect all pages
    const allItems: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result = await withTenant(orgA, async (tx) => {
        const repo = new DrizzleTaskRepository(tx, orgA);
        return repo.list(toPage({ limit: 2, cursor }));
      });
      const texts = result.items
        .map((t) => t.props.text)
        .filter((text) => text.startsWith(prefix));
      allItems.push(...texts);
      cursor = result.nextCursor;
      if (!result.nextCursor) break;
    }

    // No skips, no duplicates — all 5 tasks appear exactly once
    const expected = [`${prefix}t1`, `${prefix}t2`, `${prefix}t3`, `${prefix}t4`, `${prefix}t5`];
    expect(allItems).toHaveLength(expected.length);
    expect(new Set(allItems).size).toBe(expected.length);
    expect(allItems.every((t) => expected.includes(t))).toBe(true);

    // NULLS LAST pinned: the two null-dueDate tasks are the FINAL two items, dated ones first.
    // (Exact order within a dueDate can tie-break by uuid when createdAt collides at ms — so we
    // assert the zones, not the intra-zone order.)
    expect(new Set(allItems.slice(0, 3))).toEqual(new Set([`${prefix}t1`, `${prefix}t2`, `${prefix}t3`]));
    expect(new Set(allItems.slice(3))).toEqual(new Set([`${prefix}t4`, `${prefix}t5`]));
    // And the dated zone itself is dueDate-ascending: t3 (08-02) after t1/t2 (08-01).
    expect(allItems[2]).toBe(`${prefix}t3`);
  });
});
