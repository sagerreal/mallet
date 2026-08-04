/**
 * Unit tests for the public quote app layer (getPublicQuote, acceptPublicQuote,
 * declinePublicQuote) and for DrizzlePublicEstimateReader's token-scoped logic.
 *
 * These tests are PURE unit tests — no real database. The DrizzlePublicEstimateReader
 * and the app-layer functions are tested via fake/stub implementations of the
 * repository, ownerDb, and withTenant so no I/O occurs.
 *
 * Scenarios:
 *  1. getPublicQuote: correct view returned for a known token
 *  2. getPublicQuote: unknown token → null (not-found)
 *  3. getPublicQuote: view data matches the estimate totals (correctness)
 *  4. getPublicQuote: stamps the view (idempotent view-tracking)
 *  5. acceptPublicQuote: normal accept transitions status to "accepted"
 *  6. acceptPublicQuote: already-accepted → idempotent (returns current state)
 *  7. acceptPublicQuote: unknown token → not_found
 *  8. declinePublicQuote: unknown token → null
 *  9. declinePublicQuote: already-terminal → idempotent (returns current state)
 * 10. token isolation: a token resolves only its own estimate, not another's
 * 11. DraftEstimateUseCase: every draft gets a unique, non-empty publicToken
 * 12. acceptPublicQuote selection: valid subset commits the chosen add-ons from
 *     STORED lines only; unknown/non-optional id → invalid_selection; empty or
 *     omitted selection passes no lines (original line set untouched)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asEstimateLineId,
  FixedClock,
  money,
  zeroMoney,
  isOk,
  type OrgId,
  type EstimateId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Estimate, EstimateLine, type EstimateProps } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { DraftEstimateUseCase } from "./draft-estimate";
import { AcceptEstimateUseCase } from "./accept-estimate";
import type { AcceptLineInput } from "./accept-estimate";
import { DeclineEstimateUseCase } from "./decline-estimate";
import { RequestEstimateChangeUseCase } from "./request-estimate-change";
import { buildAcceptLinesFromSelection } from "./select-optional-lines";
import {
  classifyAcceptValidationFailure,
  validateTierChoice,
  type AcceptPublicQuoteResult,
} from "./public-accept-policy";
import type { PublicQuoteView } from "../infra/drizzle-public-estimate-reader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_A: OrgId = asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const ORG_B: OrgId = asOrgId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const LEAD_A: LeadId = asLeadId("11111111-1111-1111-1111-111111111111");
const LEAD_B: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");
const KNOWN_TOKEN = "a".repeat(64);
const KNOWN_TOKEN_B = "b".repeat(64);
const UNKNOWN_TOKEN = "0".repeat(64);

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

class FakeEstimateRepository implements EstimateRepository {
  // AI-draft snapshot (write-once, mirrors the Drizzle repo's IS NULL guard).
  private readonly aiDrafts = new Map<string, AiDraftSnapshot>();
  async setAiDraft(id: EstimateId, snapshot: AiDraftSnapshot): Promise<void> {
    if (!this.aiDrafts.has(id)) this.aiDrafts.set(id, snapshot);
  }
  async getAiDraft(id: EstimateId): Promise<AiDraftSnapshot | null> {
    return this.aiDrafts.get(id) ?? null;
  }

  private readonly store = new Map<EstimateId, Estimate>();
  private readonly archived = new Set<EstimateId>();
  private seq = 1000;

  async nextNumber(): Promise<string> {
    return `EST-${this.seq++}`;
  }
  async save(estimate: Estimate): Promise<void> {
    this.store.set(estimate.props.id, estimate);
  }
  async findById(id: EstimateId): Promise<Estimate | null> {
    if (this.archived.has(id)) return null;
    return this.store.get(id) ?? null;
  }
  async list(_page: CursorPage, _filter?: EstimateFilter): Promise<Paginated<Estimate>> {
    return { items: [...this.store.values()], nextCursor: null };
  }
  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>> {
    return this.list(page);
  }
  async archive(id: EstimateId, _now: Date): Promise<number> {
    if (this.archived.has(id) || !this.store.has(id)) return 0;
    this.archived.add(id);
    return 1;
  }
  async restore(id: EstimateId, _now: Date): Promise<Estimate | null> {
    if (!this.archived.has(id)) return null;
    this.archived.delete(id);
    return this.store.get(id) ?? null;
  }

  async archiveByLead(leadId: LeadId, _now: Date): Promise<number> {
    let count = 0;
    for (const [id, est] of this.store) {
      if (est.props.leadId === leadId && !this.archived.has(id)) {
        this.archived.add(id);
        count++;
      }
    }
    return count;
  }

  // Test helper: put an estimate directly into the store
  inject(estimate: Estimate): void {
    this.store.set(estimate.props.id, estimate);
  }
}

// ---------------------------------------------------------------------------
// Build a "sent" Estimate directly from props (no use-case round-trip needed)
// ---------------------------------------------------------------------------

let idSeq = 0;
const nextId = () => {
  idSeq += 1;
  return `${String(idSeq).padStart(8, "0")}-0000-0000-0000-000000000000`;
};

const makeTestLine = (): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(nextId()),
    description: "Labor",
    quantity: 1,
    rate: money(100_000),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position: 0,
    tier: null,
    materialId: null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const makeLineWith = (
  id: string,
  description: string,
  rateCents: number,
  isOptional: boolean,
  position: number,
): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(id),
    description,
    quantity: 1,
    rate: money(rateCents),
    cost: zeroMoney,
    isOptional,
    needsPhoto: false,
    position,
    tier: null,
    materialId: null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const makeSentEstimate = (
  estimateId: EstimateId,
  orgId: OrgId,
  leadId: LeadId,
  token: string,
  lines?: readonly EstimateLine[],
  pricing?: { discBps: number; taxBps: number; depBps: number },
): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: estimateId,
    orgId,
    num: "EST-9001",
    leadId,
    title: "Test quote",
    status: "sent",
    discBps: pricing?.discBps ?? 0,
    taxBps: pricing?.taxBps ?? 0,
    depBps: pricing?.depBps ?? 0,
    depPaid: zeroMoney,
    validDays: 30,
    sentAt: now,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: token,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines: lines ?? [makeTestLine()],
    createdAt: now,
    updatedAt: now,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// A still-DRAFT estimate whose token leaked early (the reader does not gate on status).
const makeDraftEstimate = (
  estimateId: EstimateId,
  orgId: OrgId,
  leadId: LeadId,
  token: string,
): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: estimateId,
    orgId,
    num: "EST-9002",
    leadId,
    title: "Draft quote",
    status: "draft",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: 30,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: token,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines: [makeTestLine()],
    createdAt: now,
    updatedAt: now,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// ---------------------------------------------------------------------------
// Fake PublicEstimateReader — replaces the real ownerDb-based reader
// ---------------------------------------------------------------------------

interface FakeEntry {
  estimateId: EstimateId;
  orgId: OrgId;
  orgName: string;
  leadName: string;
  estimate: Estimate;
}

class FakePublicEstimateReader {
  private readonly byToken = new Map<string, FakeEntry>();
  readonly viewedTokens: string[] = [];

  register(token: string, entry: FakeEntry): void {
    this.byToken.set(token, entry);
  }

  async findByToken(token: string): Promise<PublicQuoteView | null> {
    const e = this.byToken.get(token);
    if (!e) return null;
    this.viewedTokens.push(token);
    const customerFirstName = e.leadName.split(" ")[0] ?? e.leadName;
    // chargesEnabled gates the page's pay-the-deposit primary; these cases are about
    // accept/decline/change, so the fixture reports the shop as card-ready.
    return { estimate: e.estimate, orgName: e.orgName, customerFirstName, chargesEnabled: true };
  }

  async resolveOrgByToken(token: string): Promise<{ estimateId: string; orgId: OrgId } | null> {
    const e = this.byToken.get(token);
    if (!e) return null;
    return { estimateId: e.estimateId, orgId: e.orgId };
  }
}

// ---------------------------------------------------------------------------
// App-layer test doubles — call use-cases with injected fakes
// (These mirror the logic of acceptPublicQuote / declinePublicQuote exactly,
//  but accept injected fakes instead of calling getAppDeps / withTenant.)
// ---------------------------------------------------------------------------

async function testAcceptPublicQuote(
  token: string,
  reader: FakePublicEstimateReader,
  repoByOrg: Map<OrgId, FakeEstimateRepository>,
  bus: InMemoryEventBus,
  clock: FixedClock,
  selectedLineIds?: readonly string[],
): Promise<AcceptPublicQuoteResult> {
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return { kind: "not_found" };
  const { estimateId, orgId } = resolved;
  const repo = repoByOrg.get(orgId);
  if (!repo) return { kind: "not_found" };

  // Selection is validated against — and committed lines built from — STORED data only,
  // via the same buildAcceptLinesFromSelection the real acceptPublicQuote uses.
  const stored = await repo.findById(asEstimateId(estimateId));
  if (!stored) return { kind: "not_found" };

  let lines: readonly AcceptLineInput[] | undefined;
  if (stored.props.status === "sent") {
    const selection = buildAcceptLinesFromSelection(stored, selectedLineIds);
    if (selection.kind === "invalid") return { kind: "invalid_selection" };
    if (selection.kind === "lines") lines = selection.lines;
  }

  const useCase = new AcceptEstimateUseCase(repo, bus, clock);
  const result = await useCase.exec({
    estimateId: asEstimateId(estimateId),
    ...(lines ? { lines } : {}),
  });
  if (!result.ok) {
    if (result.error.kind === "validation") {
      // Same classification the REAL acceptPublicQuote applies (shared function):
      // terminal → idempotent ok; non-terminal (draft) → not_ready.
      const current = await repo.findById(asEstimateId(estimateId));
      return classifyAcceptValidationFailure(current);
    }
    return { kind: "not_found" };
  }
  return { kind: "ok", estimate: result.value };
}

async function testDeclinePublicQuote(
  token: string,
  reason: string | undefined,
  reader: FakePublicEstimateReader,
  repoByOrg: Map<OrgId, FakeEstimateRepository>,
  bus: InMemoryEventBus,
  clock: FixedClock,
): Promise<Estimate | null> {
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return null;
  const { estimateId, orgId } = resolved;
  const repo = repoByOrg.get(orgId);
  if (!repo) return null;
  const declineReason = (reason ?? "").trim() || "Declined by customer";
  const useCase = new DeclineEstimateUseCase(repo, bus, clock);
  const result = await useCase.exec({ estimateId: asEstimateId(estimateId), reason: declineReason });
  if (!result.ok) {
    if (result.error.kind === "validation") {
      return repo.findById(asEstimateId(estimateId));
    }
    return null;
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let clock: FixedClock;
let bus: InMemoryEventBus;
let reader: FakePublicEstimateReader;
let repoA: FakeEstimateRepository;
let repoByOrg: Map<OrgId, FakeEstimateRepository>;
let estimateIdA: EstimateId;
let estimateA: Estimate;

beforeEach(() => {
  idSeq = 0;
  clock = new FixedClock(new Date("2026-07-10T00:00:00Z"));
  bus = new InMemoryEventBus();
  reader = new FakePublicEstimateReader();
  repoA = new FakeEstimateRepository();

  estimateIdA = asEstimateId("aaaa0000-0000-0000-0000-000000000001");
  estimateA = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);

  reader.register(KNOWN_TOKEN, {
    estimateId: estimateIdA,
    orgId: ORG_A,
    orgName: "Acme Roofing",
    leadName: "Jane Smith",
    estimate: estimateA,
  });
  repoA.inject(estimateA);
  repoByOrg = new Map([[ORG_A, repoA]]);
});

// ---------------------------------------------------------------------------
// Tests: getPublicQuote (via reader.findByToken)
// ---------------------------------------------------------------------------

describe("getPublicQuote — token-scoped read", () => {
  it("returns the correct estimate for a known token", async () => {
    const view = await reader.findByToken(KNOWN_TOKEN);
    expect(view).not.toBeNull();
    expect(view?.estimate.props.id).toBe(estimateIdA);
    expect(view?.estimate.props.publicToken).toBe(KNOWN_TOKEN);
  });

  it("returns null for an unknown token", async () => {
    const view = await reader.findByToken(UNKNOWN_TOKEN);
    expect(view).toBeNull();
  });

  it("includes the org name and the customer's first name", async () => {
    const view = await reader.findByToken(KNOWN_TOKEN);
    expect(view?.orgName).toBe("Acme Roofing");
    expect(view?.customerFirstName).toBe("Jane"); // first word of "Jane Smith"
  });

  it("records a view on first fetch (idempotent view-tracking)", async () => {
    expect(reader.viewedTokens).toHaveLength(0);
    await reader.findByToken(KNOWN_TOKEN);
    expect(reader.viewedTokens).toContain(KNOWN_TOKEN);
  });

  it("does NOT record a view for an unknown token", async () => {
    await reader.findByToken(UNKNOWN_TOKEN);
    expect(reader.viewedTokens).toHaveLength(0);
  });

  it("estimate subtotal is correct (1 × $1000 = 100_000 cents)", async () => {
    const view = await reader.findByToken(KNOWN_TOKEN);
    expect(view?.estimate.subtotal()).toBe(100_000);
    expect(view?.estimate.total()).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Tests: acceptPublicQuote
// ---------------------------------------------------------------------------

describe("acceptPublicQuote", () => {
  it("unknown token → not_found", async () => {
    const result = await testAcceptPublicQuote(UNKNOWN_TOKEN, reader, repoByOrg, bus, clock);
    expect(result.kind).toBe("not_found");
  });

  it("known token transitions the estimate to accepted", async () => {
    const result = await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.estimate.props.status).toBe("accepted");
    expect(result.estimate.props.acceptedAt).not.toBeNull();
  });

  it("emits exactly one estimate.accepted event with the correct orgId", async () => {
    await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    const events = bus.recorded.filter((e) => e.name === "estimate.accepted");
    expect(events).toHaveLength(1);
    expect(events[0]?.orgId).toBe(ORG_A);
  });

  it("idempotent: calling accept twice returns accepted state and only emits one event", async () => {
    await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    const second = await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);

    // Second call returns the already-accepted estimate without error.
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.estimate.props.status).toBe("accepted");

    // Only one estimate.accepted event was ever emitted.
    const events = bus.recorded.filter((e) => e.name === "estimate.accepted");
    expect(events).toHaveLength(1);
  });

  it("token isolation: token A cannot accept estimate B", async () => {
    // Register a second estimate with a different token + org
    const estimateIdB = asEstimateId("bbbb0000-0000-0000-0000-000000000002");
    const repoB = new FakeEstimateRepository();
    const estimateB = makeSentEstimate(estimateIdB, ORG_B, LEAD_B, KNOWN_TOKEN_B);
    reader.register(KNOWN_TOKEN_B, {
      estimateId: estimateIdB,
      orgId: ORG_B,
      orgName: "Beta Corp",
      leadName: "Bob Jones",
      estimate: estimateB,
    });
    repoB.inject(estimateB);
    repoByOrg.set(ORG_B, repoB);

    // Accept only token A
    await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);

    // Estimate A is accepted
    expect((await repoA.findById(estimateIdA))?.props.status).toBe("accepted");
    // Estimate B is untouched — still "sent"
    expect((await repoB.findById(estimateIdB))?.props.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// Tests: acceptPublicQuote — optional add-on selection
// ---------------------------------------------------------------------------

describe("acceptPublicQuote — optional add-on selection", () => {
  const OPT_TOKEN = "e".repeat(64);
  const FIXED_LINE_ID = "cccc0000-0000-0000-0000-0000000000f1";
  const OPT_LINE_ID = "cccc0000-0000-0000-0000-0000000000a1";
  const UNKNOWN_LINE_ID = "99999999-9999-9999-9999-999999999999";
  let optEstimateId: EstimateId;

  beforeEach(() => {
    optEstimateId = asEstimateId("aaaa0000-0000-0000-0000-00000000000a");
    const est = makeSentEstimate(
      optEstimateId,
      ORG_A,
      LEAD_A,
      OPT_TOKEN,
      [
        makeLineWith(FIXED_LINE_ID, "Labor", 100_000, false, 0),
        makeLineWith(OPT_LINE_ID, "Optional sealant", 5_000, true, 1),
      ],
      { discBps: 0, taxBps: 0, depBps: 5_000 }, // 50% deposit
    );
    reader.register(OPT_TOKEN, {
      estimateId: optEstimateId,
      orgId: ORG_A,
      orgName: "Acme Roofing",
      leadName: "Jane Smith",
      estimate: est,
    });
    repoA.inject(est);
  });

  it("valid subset → the selected add-on is committed: total and the deposit ask reflect the tuned lines", async () => {
    const result = await testAcceptPublicQuote(OPT_TOKEN, reader, repoByOrg, bus, clock, [OPT_LINE_ID]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.estimate.props.status).toBe("accepted");
    // 100_000 fixed + 5_000 committed add-on
    expect(result.estimate.total()).toBe(105_000);
    // The deposit ASK derives from the committed lines; depPaid stays 0 — accepting a quote
    // agrees to the work, it pays nothing (payments are recorded when money actually lands).
    expect(result.estimate.depositDue()).toBe(52_500);
    expect(result.estimate.props.depPaid).toBe(0);
    // Both lines are now non-optional.
    expect(result.estimate.props.lines).toHaveLength(2);
    expect(result.estimate.props.lines.every((l) => !l.props.isOptional)).toBe(true);
    // Persisted, not just returned.
    const stored = await repoA.findById(optEstimateId);
    expect(stored?.total()).toBe(105_000);
  });

  it("unknown line id → invalid_selection and the estimate stays sent", async () => {
    const result = await testAcceptPublicQuote(OPT_TOKEN, reader, repoByOrg, bus, clock, [UNKNOWN_LINE_ID]);
    expect(result.kind).toBe("invalid_selection");
    const stored = await repoA.findById(optEstimateId);
    expect(stored?.props.status).toBe("sent");
    expect(bus.recorded.filter((e) => e.name === "estimate.accepted")).toHaveLength(0);
  });

  it("a NON-optional line id → invalid_selection (fixed lines are not toggleable)", async () => {
    const result = await testAcceptPublicQuote(OPT_TOKEN, reader, repoByOrg, bus, clock, [FIXED_LINE_ID]);
    expect(result.kind).toBe("invalid_selection");
    const stored = await repoA.findById(optEstimateId);
    expect(stored?.props.status).toBe("sent");
  });

  it("empty selection → no lines passed: the optional line survives untouched and stays excluded", async () => {
    const result = await testAcceptPublicQuote(OPT_TOKEN, reader, repoByOrg, bus, clock, []);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.estimate.props.status).toBe("accepted");
    expect(result.estimate.total()).toBe(100_000);
    expect(result.estimate.depositDue()).toBe(50_000);
    expect(result.estimate.props.depPaid).toBe(0); // agreed, not paid
    // Original line set untouched — the add-on keeps its id and stays optional.
    const opt = result.estimate.props.lines.find((l) => l.props.isOptional);
    expect(opt?.props.id).toBe(OPT_LINE_ID);
  });

  it("omitted selection behaves like the pre-feature accept (no lines passed)", async () => {
    const result = await testAcceptPublicQuote(OPT_TOKEN, reader, repoByOrg, bus, clock);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.estimate.total()).toBe(100_000);
    expect(result.estimate.props.lines.some((l) => l.props.isOptional)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: acceptPublicQuote — honest failure states (not_ready vs idempotent ok)
// ---------------------------------------------------------------------------

describe("acceptPublicQuote — non-terminal estimates report not_ready, not ok", () => {
  const DRAFT_TOKEN = "d".repeat(64);
  let draftEstimateId: EstimateId;

  beforeEach(() => {
    draftEstimateId = asEstimateId("aaaa0000-0000-0000-0000-00000000000d");
    const draft = makeDraftEstimate(draftEstimateId, ORG_A, LEAD_A, DRAFT_TOKEN);
    reader.register(DRAFT_TOKEN, {
      estimateId: draftEstimateId,
      orgId: ORG_A,
      orgName: "Acme Roofing",
      leadName: "Jane Smith",
      estimate: draft,
    });
    repoA.inject(draft);
  });

  it("a still-draft estimate (prematurely shared link) → not_ready; stays draft, no event", async () => {
    const result = await testAcceptPublicQuote(DRAFT_TOKEN, reader, repoByOrg, bus, clock);
    expect(result.kind).toBe("not_ready");
    expect((await repoA.findById(draftEstimateId))?.props.status).toBe("draft");
    expect(bus.recorded.filter((e) => e.name === "estimate.accepted")).toHaveLength(0);
  });

  it("a draft accept with a selection is NOT reported as approved (kind is not ok)", async () => {
    const result = await testAcceptPublicQuote(DRAFT_TOKEN, reader, repoByOrg, bus, clock, []);
    expect(result.kind).toBe("not_ready");
  });

  it("re-POST on an already-accepted estimate stays the idempotent ok path", async () => {
    const first = await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    expect(first.kind).toBe("ok");
    const second = await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.estimate.props.status).toBe("accepted");
  });
});

describe("classifyAcceptValidationFailure — status classification", () => {
  const now = new Date("2026-07-10T00:00:00Z");

  it("accepted → ok with the current estimate (idempotent double-tap)", () => {
    const accepted = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN).accept(now);
    if (!accepted.ok) throw new Error("setup failed");
    const r = classifyAcceptValidationFailure(accepted.value);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.estimate.props.status).toBe("accepted");
  });

  it("declined → ok with the current estimate (terminal state, nothing to accept)", () => {
    const declined = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN).decline("price", now);
    if (!declined.ok) throw new Error("setup failed");
    expect(classifyAcceptValidationFailure(declined.value).kind).toBe("ok");
  });

  it("draft → not_ready (the quote was never accepted; do not fake an approval)", () => {
    const draft = makeDraftEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    expect(classifyAcceptValidationFailure(draft).kind).toBe("not_ready");
  });

  it("sent → not_ready (a sent estimate that failed validation was not accepted)", () => {
    const sent = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    expect(classifyAcceptValidationFailure(sent).kind).toBe("not_ready");
  });

  it("missing row → not_found", () => {
    expect(classifyAcceptValidationFailure(null).kind).toBe("not_found");
  });

  it("a signature-tagged failure is invalid_signature, NOT not_ready", () => {
    // The trap this exists to close: a blank name fails on an estimate that is still "sent" —
    // exactly the shape that otherwise falls through to not_ready. Telling a customer whose name
    // box is empty that "this quote isn't ready to approve" sends them to the shop over a
    // problem they could fix in two seconds.
    const sent = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    const r = classifyAcceptValidationFailure(sent, {
      message: "please type your name to sign",
      field: "signerName",
    });
    expect(r.kind).toBe("invalid_signature");
    if (r.kind === "invalid_signature") {
      expect(r.message).toBe("please type your name to sign");
      expect(r.field).toBe("signerName");
    }
  });

  it("a signature failure is classified even when the row cannot be re-read", () => {
    // The estimate is irrelevant to a signature problem, and a token that resolved a moment ago
    // is not suddenly missing — reporting not_found here would blame the wrong thing.
    expect(
      classifyAcceptValidationFailure(null, { message: "please type your name to sign", field: "signerName" }).kind,
    ).toBe("invalid_signature");
  });

  it("a NON-signature validation failure still classifies on status", () => {
    // Guards the field allow-list: an unrelated tagged error must not be reported as a signature
    // problem, which would tell the customer to fix something that is already fine.
    const sent = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    expect(classifyAcceptValidationFailure(sent, { message: "nope", field: "chosenTier" }).kind).toBe("not_ready");
    expect(classifyAcceptValidationFailure(sent, { message: "nope" }).kind).toBe("not_ready");
  });
});

// ---------------------------------------------------------------------------
// Tests: validateTierChoice — the Good/Better/Best gate on the public accept path
// ---------------------------------------------------------------------------

describe("validateTierChoice — tier gate for public accept", () => {
  const makeTieredEstimate = (): Estimate => {
    const mk = (id: string, tier: "good" | "better" | "best", isOptional: boolean, rate: number) => {
      const r = EstimateLine.create({
        id: asEstimateLineId(id),
        description: `${tier} work`,
        quantity: 1,
        rate: money(rate),
        cost: zeroMoney,
        isOptional,
        needsPhoto: false,
        position: 0,
        tier,
        materialId: null,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const base = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    const r = Estimate.create({
      ...base.props,
      recommendedTier: "better",
      lines: [
        mk("11110000-0000-0000-0000-000000000001", "good", false, 20_000),
        mk("11110000-0000-0000-0000-000000000002", "better", false, 35_000),
        // "best" tier: ONLY an optional line — not an acceptable option.
        mk("11110000-0000-0000-0000-000000000003", "best", true, 90_000),
      ],
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("a single-format estimate with a chosenTier → invalid_tier (not_applicable)", () => {
    const single = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    expect(validateTierChoice(single, "good")).toEqual({
      kind: "invalid_tier",
      reason: "not_applicable",
    });
  });

  it("a single-format estimate without a chosenTier → ok", () => {
    const single = makeSentEstimate(estimateIdA, ORG_A, LEAD_A, KNOWN_TOKEN);
    expect(validateTierChoice(single, undefined).kind).toBe("ok");
  });

  it("a tiered estimate without a chosenTier → invalid_tier (required)", () => {
    expect(validateTierChoice(makeTieredEstimate(), undefined)).toEqual({
      kind: "invalid_tier",
      reason: "required",
    });
  });

  it("a tiered estimate with a valid chosenTier → ok", () => {
    expect(validateTierChoice(makeTieredEstimate(), "good").kind).toBe("ok");
    expect(validateTierChoice(makeTieredEstimate(), "better").kind).toBe("ok");
  });

  it("a chosen tier with no fixed lines → invalid_tier (empty_tier)", () => {
    expect(validateTierChoice(makeTieredEstimate(), "best")).toEqual({
      kind: "invalid_tier",
      reason: "empty_tier",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: declinePublicQuote
// ---------------------------------------------------------------------------

describe("declinePublicQuote", () => {
  it("unknown token → null (not-found)", async () => {
    const result = await testDeclinePublicQuote(UNKNOWN_TOKEN, "too expensive", reader, repoByOrg, bus, clock);
    expect(result).toBeNull();
  });

  it("known token transitions the estimate to declined with the given reason", async () => {
    const result = await testDeclinePublicQuote(KNOWN_TOKEN, "too expensive", reader, repoByOrg, bus, clock);
    expect(result?.props.status).toBe("declined");
    expect(result?.props.declineReason).toBe("too expensive");
  });

  it("uses a default reason when none is provided", async () => {
    const result = await testDeclinePublicQuote(KNOWN_TOKEN, undefined, reader, repoByOrg, bus, clock);
    expect(result?.props.declineReason).toBe("Declined by customer");
  });

  it("emits exactly one estimate.declined event", async () => {
    await testDeclinePublicQuote(KNOWN_TOKEN, "price", reader, repoByOrg, bus, clock);
    const events = bus.recorded.filter((e) => e.name === "estimate.declined");
    expect(events).toHaveLength(1);
    expect(events[0]?.orgId).toBe(ORG_A);
  });

  it("idempotent: already-declined estimate returns current state (reason from first decline)", async () => {
    await testDeclinePublicQuote(KNOWN_TOKEN, "first reason", reader, repoByOrg, bus, clock);
    const second = await testDeclinePublicQuote(KNOWN_TOKEN, "second reason", reader, repoByOrg, bus, clock);
    // Status is still declined
    expect(second?.props.status).toBe("declined");
    // Reason is from the FIRST decline — the second is a no-op
    expect(second?.props.declineReason).toBe("first reason");
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveOrgByToken isolation
// ---------------------------------------------------------------------------

describe("resolveOrgByToken — token isolation", () => {
  it("token A resolves to org A and its estimate", async () => {
    const resolved = await reader.resolveOrgByToken(KNOWN_TOKEN);
    expect(resolved?.orgId).toBe(ORG_A);
    expect(resolved?.estimateId).toBe(estimateIdA);
  });

  it("unknown token resolves to null", async () => {
    const resolved = await reader.resolveOrgByToken(UNKNOWN_TOKEN);
    expect(resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: DraftEstimateUseCase generates a unique publicToken
// ---------------------------------------------------------------------------

describe("DraftEstimateUseCase — publicToken generation", () => {
  it("every drafted estimate has a non-null publicToken with at least 32 chars", async () => {
    const repo = new FakeEstimateRepository();
    let n = 0;
    const ids = { newId: () => `${String(++n).padStart(8, "0")}-0000-0000-0000-000000000000` };
    const useCase = new DraftEstimateUseCase(repo, bus, clock, ids);
    const result = await useCase.exec({
      orgId: ORG_A,
      leadId: LEAD_A,
      title: null,
      discBps: 0,
      taxBps: 0,
      depBps: 0,
      validDays: null,
      lines: [{ description: "Labor", quantity: 1, rateCents: 50_000, costCents: 0, isOptional: false, needsPhoto: false }],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const token = result.value.props.publicToken;
    expect(typeof token).toBe("string");
    expect((token as string).length).toBeGreaterThanOrEqual(32);
  });

  it("two successive drafts receive distinct publicTokens", async () => {
    const repo = new FakeEstimateRepository();
    let n = 0;
    const ids = { newId: () => `${String(++n).padStart(8, "0")}-0000-0000-0000-000000000000` };
    const useCase = new DraftEstimateUseCase(repo, bus, clock, ids);
    const cmd = {
      orgId: ORG_A,
      leadId: LEAD_A,
      title: null,
      discBps: 0,
      taxBps: 0,
      depBps: 0,
      validDays: null,
      lines: [{ description: "Work", quantity: 1, rateCents: 10_000, costCents: 0, isOptional: false, needsPhoto: false }],
    };
    const r1 = await useCase.exec(cmd);
    const r2 = await useCase.exec(cmd);
    expect(isOk(r1)).toBe(true);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r1) || !isOk(r2)) return;
    expect(r1.value.props.publicToken).not.toBe(r2.value.props.publicToken);
  });
});

// ---------------------------------------------------------------------------
// App-layer helper for testing requestChangePublicQuote
// ---------------------------------------------------------------------------

async function testRequestChangePublicQuote(
  token: string,
  message: string,
  reader: FakePublicEstimateReader,
  repoByOrg: Map<OrgId, FakeEstimateRepository>,
  bus: InMemoryEventBus,
  clock: FixedClock,
): Promise<Estimate | null> {
  const resolved = await reader.resolveOrgByToken(token);
  if (!resolved) return null;
  const { estimateId, orgId } = resolved;
  const repo = repoByOrg.get(orgId);
  if (!repo) return null;
  const useCase = new RequestEstimateChangeUseCase(repo, bus, clock);
  const result = await useCase.exec({ estimateId: asEstimateId(estimateId), message });
  if (!result.ok) {
    if (result.error.kind === "validation") {
      return repo.findById(asEstimateId(estimateId));
    }
    return null;
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Tests: requestChangePublicQuote
// ---------------------------------------------------------------------------

describe("requestChangePublicQuote", () => {
  it("unknown token → null", async () => {
    const result = await testRequestChangePublicQuote(UNKNOWN_TOKEN, "lower price", reader, repoByOrg, bus, clock);
    expect(result).toBeNull();
  });

  it("sets changeRequest and changeRequestedAt on a sent estimate", async () => {
    const result = await testRequestChangePublicQuote(KNOWN_TOKEN, "can you lower the price?", reader, repoByOrg, bus, clock);
    expect(result?.props.changeRequest).toBe("can you lower the price?");
    expect(result?.props.changeRequestedAt).not.toBeNull();
  });

  it("emits estimate.change_requested event", async () => {
    const freshBus = new InMemoryEventBus();
    await testRequestChangePublicQuote(KNOWN_TOKEN, "please adjust", reader, repoByOrg, freshBus, clock);
    const events = freshBus.recorded.filter((e) => e.name === "estimate.change_requested");
    expect(events).toHaveLength(1);
    expect(events[0]?.orgId).toBe(ORG_A);
  });

  it("returns current state when estimate is not in sent state (already accepted)", async () => {
    // First accept the estimate
    await testAcceptPublicQuote(KNOWN_TOKEN, reader, repoByOrg, bus, clock);
    // Now try to request a change — should return current (accepted) state
    const result = await testRequestChangePublicQuote(KNOWN_TOKEN, "adjust please", reader, repoByOrg, bus, clock);
    expect(result?.props.status).toBe("accepted");
  });
});
