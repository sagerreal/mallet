import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  asLeadId, asOrgId, zeroMoney, Phone, FixedClock, isOk,
  type OrgId, type LeadId,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Lead } from "../domain/lead";
import type { LeadRepository, EnsureCustomerInput, EnsureCustomerResult } from "../domain/lead-repository";
import { EnsureCustomerUseCase } from "./ensure-customer";
import { ResolveCustomerRefsUseCase } from "./resolve-customer-refs";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");

/** Minimal double: only the three methods the resolver touches behave; the rest throw if used. */
class Repo implements Partial<LeadRepository> {
  readonly store = new Map<LeadId, Lead>();

  constructor(private readonly clock: FixedClock) {}

  seed(name: string, phone: string | null): Lead {
    const parsed = phone ? Phone.parse(phone) : null;
    const now = this.clock.now();
    const lead = Lead.create({
      id: asLeadId(randomUUID()), orgId: ORG, name,
      phone: parsed && isOk(parsed) ? parsed.value : null,
      email: null, customFields: null, source: null, stage: "new", value: zeroMoney,
      unread: false, wonAt: null, companyId: null, role: null, notes: null,
      lossReason: null, pipelineStageId: null, address: null, createdAt: now, updatedAt: now,
    });
    if (!isOk(lead)) throw new Error("seed failed");
    this.store.set(lead.value.props.id, lead.value);
    return lead.value;
  }

  async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    if (input.phone !== null) {
      const hit = [...this.store.values()].find((l) => l.props.phone === input.phone);
      if (hit) return { lead: hit, created: false };
    }
    return { lead: this.seed(input.name, input.phone), created: true };
  }

  async findByNames(names: readonly string[]): Promise<Lead[]> {
    const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
    return [...this.store.values()].filter((l) => wanted.has(l.props.name.trim().toLowerCase()));
  }
}

describe("ResolveCustomerRefsUseCase", () => {
  let repo: Repo;
  let resolve: ResolveCustomerRefsUseCase;

  beforeEach(() => {
    const clock = new FixedClock(new Date("2026-08-11T10:00:00Z"));
    repo = new Repo(clock);
    resolve = new ResolveCustomerRefsUseCase({
      leads: repo as unknown as LeadRepository,
      ensureCustomer: new EnsureCustomerUseCase(
        repo as unknown as LeadRepository,
        new InMemoryEventBus(),
        clock,
      ),
    });
  });

  it("matches on phone even when the name differs", async () => {
    const existing = repo.seed("Gary Pratt", "(925) 555-0100");
    const [hit] = await resolve.exec([{ name: "G. Pratt", phone: "925-555-0100" }], "Import");

    expect(hit!.lead.props.id).toBe(existing.props.id);
    expect(hit!.created).toBe(false);
  });

  it("falls back to an exact name match, case-insensitively, when there is no phone", async () => {
    const existing = repo.seed("Gary Pratt", null);
    const [hit] = await resolve.exec([{ name: "gary pratt", phone: null }], "Import");

    expect(hit!.lead.props.id).toBe(existing.props.id);
    expect(hit!.created).toBe(false);
  });

  it("creates a customer when neither phone nor name matches", async () => {
    const [hit] = await resolve.exec([{ name: "Brand New", phone: "925-555-0199" }], "Import");

    expect(hit!.created).toBe(true);
    expect(hit!.lead.props.name).toBe("Brand New");
    expect(hit!.ambiguousName).toBeUndefined();
  });

  it("creates a NEW customer and flags the row when a name matches two people", async () => {
    repo.seed("Gary Pratt", "925-555-0100");
    repo.seed("Gary Pratt", "925-555-0111");

    const [hit] = await resolve.exec([{ name: "Gary Pratt", phone: null }], "Import");

    // Attaching the job to the wrong Gary is invisible and unfixable; a duplicate is neither.
    expect(hit!.created).toBe(true);
    expect(hit!.ambiguousName).toBe("Gary Pratt");
  });

  it("prefers the phone match over an ambiguous name", async () => {
    repo.seed("Gary Pratt", "925-555-0100");
    const target = repo.seed("Gary Pratt", "925-555-0111");

    const [hit] = await resolve.exec([{ name: "Gary Pratt", phone: "925-555-0111" }], "Import");

    expect(hit!.lead.props.id).toBe(target.props.id);
    expect(hit!.created).toBe(false);
    expect(hit!.ambiguousName).toBeUndefined();
  });

  it("reuses a customer created earlier in the SAME chunk instead of creating twice", async () => {
    const results = await resolve.exec(
      [
        { name: "Repeat Customer", phone: "925-555-0150" },
        { name: "Repeat Customer", phone: "925-555-0150" },
      ],
      "Import",
    );

    expect(results[0]!.created).toBe(true);
    expect(results[1]!.created).toBe(false);
    expect(results[0]!.lead.props.id).toBe(results[1]!.lead.props.id);
    expect(repo.store.size).toBe(1);
  });

  it("keeps results aligned with input order", async () => {
    repo.seed("Second", null);
    const results = await resolve.exec(
      [{ name: "First", phone: null }, { name: "Second", phone: null }, { name: "Third", phone: null }],
      "Import",
    );

    expect(results.map((r) => r!.lead.props.name)).toEqual(["First", "Second", "Third"]);
  });

  it("returns null for a ref the domain rejects, without derailing the chunk", async () => {
    const results = await resolve.exec(
      [{ name: "Fine", phone: null }, { name: "   ", phone: null }],
      "Import",
    );

    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });

  it("ignores an unreadable phone rather than failing the row", async () => {
    const [hit] = await resolve.exec([{ name: "Bad Phone", phone: "555" }], "Import");

    expect(hit!.created).toBe(true);
    expect(hit!.lead.props.phone).toBeNull();
  });
});
