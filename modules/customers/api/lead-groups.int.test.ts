import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { leads } from "@mallet/shared/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { LEAD_GROUPS, leadGroupCondition, type LeadGroup } from "../infra/lead-views";

/**
 * The Customers list's work groups, in SQL.
 *
 * The property that matters is EXCLUSIVITY. Each arm excludes the ones ranked above it by hand, so
 * a customer in several situations at once — and most real ones are — is counted exactly once. Get
 * that wrong and every chip on the screen overstates, which is the failure mode the stored `stage`
 * column had in a different form.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("customers list — work groups (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  const named = new Map<string, string>();

  const addLead = async (name: string) => {
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, ${name}) returning id`;
    named.set(name, l!.id);
    return l!.id;
  };
  const addEstimate = (leadId: string, status: string) =>
    admin`insert into estimates (org_id, lead_id, num, status)
          values (${orgId}, ${leadId}, ${"E-" + randomUUID().slice(0, 8)}, ${status})`;
  const addJob = async (leadId: string) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${"J-" + randomUUID().slice(0, 8)}, 'scheduled', 50000) returning id`;
    return j!.id;
  };
  const addVisit = (jobId: string, status: string) =>
    admin`insert into job_visits (org_id, job_id, scheduled_date, duration_minutes, status)
          values (${orgId}, ${jobId}, current_date, 120, ${status})`;
  const addInvoice = (leadId: string, jobId: string | null, status: string, total: number, paid: number) =>
    admin`insert into invoices (org_id, lead_id, source_job_id, num, status, total_cents, amount_paid_cents)
          values (${orgId}, ${leadId}, ${jobId}, ${"INV-" + randomUUID().slice(0, 8)}, ${status}, ${total}, ${paid})`;

  /** A finished job that HAS been billed and settled — the plain "work completed" shape. */
  const seedSettled = async (name: string) => {
    const leadId = await addLead(name);
    const jobId = await addJob(leadId);
    await addVisit(jobId, "complete");
    await addInvoice(leadId, jobId, "paid", 50000, 50000);
    return leadId;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadGroups ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    // One clean example of each group.
    await addLead("Never Booked");

    const unbilled = await addLead("Invoice Required");
    await addVisit(await addJob(unbilled), "complete");

    const owing = await seedSettled("Owes Money");
    await addInvoice(owing, null, "sent", 31000, 0);

    await addEstimate(await addLead("Quote Out"), "sent");

    const booked = await addLead("Job Booked");
    await addVisit(await addJob(booked), "pending");

    await addEstimate(await addLead("Lost Deal"), "declined");
    await seedSettled("Work Completed");

    // A customer who bought before and later declined an upsell. NOT lost — they are a customer
    // who said no once, and filing them as dead is how a good repeat relationship disappears.
    const repeat = await seedSettled("Declined An Upsell");
    await addEstimate(repeat, "declined");

    // Qualifies for four groups at once. Unbilled work must win: it is the only one the shop can
    // fix without the customer.
    const everything = await addLead("All At Once");
    await addVisit(await addJob(everything), "complete");
    await addVisit(await addJob(everything), "pending");
    await addEstimate(everything, "sent");
    await addInvoice(everything, null, "sent", 20000, 0);
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /**
   * Every group this one customer matches. Asked of ALL seven rather than "which one is it", so an
   * overlap shows up as a two-element array instead of hiding behind a passing assertion.
   */
  const groupsFor = async (name: string): Promise<LeadGroup[]> => {
    const id = named.get(name)!;
    return withTenant(asOrgId(orgId), async (tx) => {
      const hits: LeadGroup[] = [];
      for (const g of LEAD_GROUPS) {
        const [mine] = await tx
          .select({ n: count() })
          .from(leads)
          .where(and(leadGroupCondition(g, tx), isNull(leads.deletedAt), eq(leads.id, id)));
        if (mine!.n > 0) hits.push(g);
      }
      return hits;
    });
  };

  it.each([
    ["Never Booked", "neverBooked"],
    ["Invoice Required", "invoiceRequired"],
    ["Owes Money", "owesMoney"],
    ["Quote Out", "quoteOut"],
    ["Job Booked", "jobBooked"],
    ["Lost Deal", "lost"],
    ["Work Completed", "workCompleted"],
  ] as const)("%s lands in %s and nowhere else", async (name, group) => {
    expect(await groupsFor(name)).toEqual([group]);
  });

  it("a repeat customer who declines an upsell is not Lost", async () => {
    expect(await groupsFor("Declined An Upsell")).toEqual(["workCompleted"]);
  });

  it("unbilled work outranks everything — the one the shop can fix alone", async () => {
    expect(await groupsFor("All At Once")).toEqual(["invoiceRequired"]);
  });

  /**
   * THE PROPERTY THE CHIPS DEPEND ON. If the seven counts do not sum to the book, every number on
   * the screen overstates and the list is lying in a way nobody notices.
   */
  it("the seven groups sum to the live book, with no customer counted twice", async () => {
    await withTenant(asOrgId(orgId), async (tx) => {
      const [all] = await tx.select({ n: count() }).from(leads).where(isNull(leads.deletedAt));
      let total = 0;
      for (const g of LEAD_GROUPS) {
        const [row] = await tx
          .select({ n: count() })
          .from(leads)
          .where(and(leadGroupCondition(g, tx), isNull(leads.deletedAt)));
        total += row!.n;
      }
      expect(total).toBe(all!.n);
    });
  });
});
