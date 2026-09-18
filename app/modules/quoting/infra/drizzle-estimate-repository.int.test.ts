import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asEstimateLineId,
  money,
  zeroMoney,
  toPage,
  isOk,
  type OrgId,
  type LeadId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Estimate, EstimateLine, type EstimateProps, type QuoteTier } from "../domain/estimate";
import { DrizzleEstimateRepository } from "./drizzle-estimate-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const line = (desc: string, rateCents: number, tier: QuoteTier | null = null): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(randomUUID()),
    description: desc,
    quantity: 1,
    rate: money(rateCents),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position: 0,
    tier,
    materialId: null,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const draftEstimate = (
  orgId: OrgId,
  leadId: LeadId,
  num: string,
  lines: EstimateLine[],
  overrides: Partial<EstimateProps> = {},
): Estimate => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Estimate.create({
    id: asEstimateId(randomUUID()),
    orgId,
    num,
    leadId,
    title: "Job",
    status: "draft",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: null,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: null,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

suite("DrizzleEstimateRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let leadBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteTest A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteTest B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    const [lb] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgBId}, 'Cust B') returning id`;
    leadAId = la!.id;
    leadBId = lb!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("allocates gapless per-org numbers starting at EST-1000", async () => {
    const orgA = asOrgId(orgAId);
    const nums = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgA);
      return [await repo.nextNumber(), await repo.nextNumber()];
    });
    expect(nums).toEqual(["EST-1000", "EST-1001"]);
  });

  it("saves the aggregate and diffs its lines (add/edit/remove) on re-save", async () => {
    const orgA = asOrgId(orgAId);
    const leadA = asLeadId(leadAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgA);
      const num = await repo.nextNumber();
      const l1 = line("A", 1_000);
      const l2 = line("B", 2_000);
      const l3 = line("C", 3_000);
      const est = draftEstimate(orgA, leadA, num, [l1, l2, l3]);
      await repo.save(est);
      const first = await repo.findById(est.props.id);

      // Keep l1 (edit rate) + l3, drop l2, add l4.
      const l1Edited = EstimateLine.create({ ...l1.props, rate: money(1_500) });
      if (!isOk(l1Edited)) throw new Error("edit failed");
      const l4 = line("D", 4_000);
      const edited = est.withLines([l1Edited.value, l3, l4], new Date("2026-06-02T00:00:00Z"));
      if (!isOk(edited)) throw new Error("withLines failed");
      await repo.save(edited.value);
      const second = await repo.findById(est.props.id);
      return { firstCount: first?.props.lines.length, second };
    });

    expect(result.firstCount).toBe(3);
    const descriptions = result.second?.props.lines.map((l) => l.props.description).sort();
    expect(descriptions).toEqual(["A", "C", "D"]); // B removed, D added
    // subtotal reflects the edited l1 rate (1500) + 3000 + 4000
    expect(result.second?.subtotal()).toBe(8_500);
  });

  it("round-trips the tier columns and persists changes on re-save (onConflictDoUpdate path)", async () => {
    const orgA = asOrgId(orgAId);
    const leadA = asLeadId(leadAId);
    const names = { good: "Patch", better: "Repair", best: "Replace" };
    const terms = "Net 15. Workmanship warranty: 1 year.";

    const out = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgA);
      const est = draftEstimate(
        orgA,
        leadA,
        await repo.nextNumber(),
        [line("Good fix", 10_000, "good"), line("Better fix", 20_000, "better"), line("Best fix", 30_000, "best")],
        { recommendedTier: "better", tierNames: names, termsSnapshot: terms },
      );
      await repo.save(est);
      const first = await repo.findById(est.props.id);

      // Send → accept("best") → re-save: exercises the header UPDATE set list (acceptedTier)
      // and the line UPDATE (tier cleared) — the paths the change-request columns once missed.
      const sent = est.send(new Date("2026-06-02T00:00:00Z"));
      if (!isOk(sent)) throw new Error("send failed");
      const accepted = sent.value.accept(new Date("2026-06-03T00:00:00Z"), "best");
      if (!isOk(accepted)) throw new Error("accept failed");
      await repo.save(accepted.value);
      const second = await repo.findById(est.props.id);
      return { first, second };
    });

    // INSERT path: all four header columns + the line tags round-trip.
    expect(out.first?.props.recommendedTier).toBe("better");
    expect(out.first?.props.acceptedTier).toBeNull();
    expect(out.first?.props.tierNames).toEqual(names);
    expect(out.first?.props.termsSnapshot).toBe(terms);
    expect([...(out.first?.props.lines ?? [])].map((l) => l.props.tier).sort()).toEqual([
      "best",
      "better",
      "good",
    ]);
    expect(out.first?.total()).toBe(20_000); // recommended tier pre-accept

    // UPDATE path: acceptedTier stamped, lines resolved to the chosen tier with tags cleared.
    expect(out.second?.props.acceptedTier).toBe("best");
    expect(out.second?.props.recommendedTier).toBe("better");
    expect(out.second?.props.lines).toHaveLength(1);
    expect(out.second?.props.lines[0]?.props.tier).toBeNull();
    expect(out.second?.total()).toBe(30_000); // resolved (chosen-tier) total
  });

  it("cannot see another org's estimate — by id or in a list", async () => {
    const orgA = asOrgId(orgAId);
    const leadA = asLeadId(leadAId);
    const estId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgA);
      const est = draftEstimate(orgA, leadA, await repo.nextNumber(), [line("Only A", 5_000)]);
      await repo.save(est);
      return est.props.id;
    });

    const orgB = asOrgId(orgBId);
    const seen = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgB);
      const byId = await repo.findById(estId);
      const listed = await repo.list(toPage({ limit: 100 }));
      return { byId, ids: listed.items.map((e) => e.props.id) };
    });

    expect(seen.byId).toBeNull();
    expect(seen.ids).not.toContain(estId);
  });

  it("rejects saving an estimate stamped with another org's id (RLS WITH CHECK)", async () => {
    const orgA = asOrgId(orgAId);
    const leadB = asLeadId(leadBId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleEstimateRepository(tx, asOrgId(orgBId));
        await repo.save(draftEstimate(asOrgId(orgBId), leadB, "EST-9999", [line("X", 1_000)]));
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("round-trips scope, sub-items and price display, and updates them on re-save", async () => {
    const orgA = asOrgId(orgAId);
    const leadA = asLeadId(leadAId);
    const scoped = EstimateLine.create({
      id: asEstimateLineId(randomUUID()),
      description: "New Construction Interior Painting",
      quantity: 1,
      rate: money(2_145_000),
      cost: zeroMoney,
      isOptional: false,
      needsPhoto: false,
      position: 0,
      tier: null,
      materialId: null,
      scope: "Includes:\n1. Walls\n2. Trim",
      subItems: [{ description: "Walls", quantity: 2400, unit: "sq ft", amountCents: 984_000 }],
    });
    if (!isOk(scoped)) throw new Error(scoped.error.message);

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleEstimateRepository(tx, orgA);
      const est = draftEstimate(orgA, leadA, await repo.nextNumber(), [scoped.value], {
        priceDisplay: "total",
      });
      await repo.save(est);

      const loaded = await repo.findById(est.props.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.priceDisplay()).toBe("total");
      const lp = loaded!.props.lines[0]?.props;
      expect(lp?.scope).toBe("Includes:\n1. Walls\n2. Trim");
      expect(lp?.subItems).toEqual([
        { description: "Walls", quantity: 2400, unit: "sq ft", amountCents: 984_000 },
      ]);

      // Re-save with edited scope + cleared sub-items — proves the excluded.* conflict set.
      const editedLine = EstimateLine.create({
        ...lp!,
        scope: "Includes:\n1. Walls only",
        subItems: null,
      });
      if (!isOk(editedLine)) throw new Error(editedLine.error.message);
      const edited = loaded!.withLinesForAccept([editedLine.value], new Date());
      await repo.save(edited);

      const reloaded = await repo.findById(est.props.id);
      expect(reloaded!.props.lines[0]?.props.scope).toBe("Includes:\n1. Walls only");
      expect(reloaded!.props.lines[0]?.props.subItems).toBeNull();
    });
  });

  it("rejects an estimate in this org that references another org's lead (composite FK)", async () => {
    // Correctly stamped org A (passes RLS WITH CHECK) but pointing at org B's lead — the composite
    // FK (org_id, lead_id) -> leads(org_id, id) must reject it.
    const orgA = asOrgId(orgAId);
    const leadB = asLeadId(leadBId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleEstimateRepository(tx, orgA);
        await repo.save(draftEstimate(orgA, leadB, await repo.nextNumber(), [line("X", 1_000)]));
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
