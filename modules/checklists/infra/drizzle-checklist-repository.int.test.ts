import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asChecklistId, asChecklistItemId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleChecklistRepository } from "./drizzle-checklist-repository";

// Live RLS integration: tests the atomic update (replace name + items) against the real
// Supabase DB. Proves that old items are gone, new items appear, RLS blocks cross-tenant
// mutations, and a non-existent id returns null.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleChecklistRepository.update against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ChkRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ChkRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("creates a template with 2 items then updates to 3 new items — findById shows only the new 3", async () => {
    const orgA = asOrgId(orgAId);
    const checklistId = asChecklistId(randomUUID());
    const item1Id = randomUUID();
    const item2Id = randomUUID();

    // Create with 2 items.
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      await repo.create({
        id: checklistId,
        orgId: orgA,
        name: "Original name",
        trade: "Plumbing",
        stage: "job",
        match: ["original"],
        items: [
          { id: asChecklistItemId(item1Id), text: "Old step 1", type: "check", required: false, position: 0 },
          { id: asChecklistItemId(item2Id), text: "Old step 2", type: "photo", required: true, position: 1 },
        ],
      });
    });

    // Verify 2 items are present before update.
    const before = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      return repo.findById(checklistId);
    });
    expect(before?.props.items).toHaveLength(2);

    // Update: replace with 3 new items and a new name.
    const newItemIds = [randomUUID(), randomUUID(), randomUUID()];
    const updated = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      return repo.update({
        id: checklistId,
        name: "Updated name",
        items: [
          { id: asChecklistItemId(newItemIds[0]!), text: "New step A", type: "check", required: false, position: 0 },
          { id: asChecklistItemId(newItemIds[1]!), text: "New step B", type: "photo", required: true, position: 1 },
          { id: asChecklistItemId(newItemIds[2]!), text: "New step C", type: "check", required: false, position: 2 },
        ],
      });
    });

    expect(updated).not.toBeNull();
    expect(updated?.props.name).toBe("Updated name");
    expect(updated?.props.items).toHaveLength(3);
    expect(updated?.props.items.map((i) => i.props.text)).toEqual(["New step A", "New step B", "New step C"]);
    // trade/stage/match must be unchanged.
    expect(updated?.props.trade).toBe("Plumbing");
    expect(updated?.props.stage).toBe("job");
    expect(updated?.props.match).toEqual(["original"]);

    // Round-trip via findById — confirms DB persisted the replacement.
    const after = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      return repo.findById(checklistId);
    });
    expect(after?.props.name).toBe("Updated name");
    expect(after?.props.items).toHaveLength(3);
    // Old item ids must not appear.
    const afterIds = after?.props.items.map((i) => i.props.id) ?? [];
    expect(afterIds).not.toContain(item1Id);
    expect(afterIds).not.toContain(item2Id);
  });

  it("returns null when updating a non-existent id", async () => {
    const orgA = asOrgId(orgAId);
    const ghostId = asChecklistId(randomUUID());

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      return repo.update({
        id: ghostId,
        name: "Ghost",
        items: [{ id: asChecklistItemId(randomUUID()), text: "Step", type: "check", required: false, position: 0 }],
      });
    });

    expect(result).toBeNull();
  });

  it("RLS isolation: org B update of org A's template is a no-op (returns null, never mutates org A)", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);
    const checklistId = asChecklistId(randomUUID());

    // Create the template under org A.
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      await repo.create({
        id: checklistId,
        orgId: orgA,
        name: "Org A template",
        trade: "Custom",
        stage: "job",
        match: [],
        items: [{ id: asChecklistItemId(randomUUID()), text: "Org A item", type: "check", required: false, position: 0 }],
      });
    });

    // Attempt update from org B — must return null (no matching row in B's view).
    const result = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgB);
      return repo.update({
        id: checklistId,
        name: "Hijacked name",
        items: [{ id: asChecklistItemId(randomUUID()), text: "Hijacked step", type: "check", required: false, position: 0 }],
      });
    });
    expect(result).toBeNull();

    // Org A's template must be untouched.
    const orgAView = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleChecklistRepository(tx, orgA);
      return repo.findById(checklistId);
    });
    expect(orgAView?.props.name).toBe("Org A template");
    expect(orgAView?.props.items).toHaveLength(1);
    expect(orgAView?.props.items[0]!.props.text).toBe("Org A item");
  });
});
