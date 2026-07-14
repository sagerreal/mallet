import { describe, it, expect, beforeEach, vi } from "vitest";
import { asOrgId, asLeadId, ok, err, notFound, type OrgId, type LeadId } from "@mallet/shared/types";
import { OrgSettings } from "@mallet/settings/domain/org-settings";
import { baseSettingsProps } from "@mallet/settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../domain/assistant";
import type { LeadByPhoneReader } from "@mallet/messaging";
import type {
  FrontdeskCallRepository,
  RecordCallInput,
  ToolInvocationLedger,
  StartCallInput,
  CallSummary,
} from "../domain/call-record";
import { RecordCallUseCase, PRICE_REVIEW_TASK_PREFIX, type RecordCallDeps } from "./record-call";

// RecordCallUseCase wires the pure disposition + price-audit onto the persistence ports. It is the
// end-of-call-report handler: re-resolve the lead by the call's from-number, derive disposition
// from the ledger, run the price audit against the org's sanctioned amounts, persist the call,
// mark the lead unread, and file a review task on a price violation. It NEVER throws on a missing
// lead / empty ledger — those degrade to a logged, best-effort persist.

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

// A settings aggregate with a $89 service fee and one flat $150 service → allowed { 89, 150 }.
const settingsWith = (): OrgSettings => {
  const r = OrgSettings.create(
    baseSettingsProps({
      orgId: ORG,
      brandName: "Acme Plumbing",
      booking: {
        services: [
          { name: "Drain clear", lane: "repair", triggers: "clog" },
          { name: "Faucet swap", lane: "flat", price: 150, triggers: "faucet" },
        ],
        notServices: "septic",
        serviceFee: 89,
        feeCredited: true,
      },
    }),
  );
  if (r.ok === false) throw new Error("bad fixture");
  return r.value;
};

class FakeCallRepo implements FrontdeskCallRepository {
  readonly recorded: RecordCallInput[] = [];
  async upsertInboundStart(_input: StartCallInput): Promise<void> {}
  async recordEndOfCall(input: RecordCallInput): Promise<void> {
    this.recorded.push(input);
  }
  async listByLead(_leadId: LeadId): Promise<CallSummary[]> {
    return [];
  }
  async listRecent(): Promise<CallSummary[]> {
    return [];
  }
}

class FakeLedger implements ToolInvocationLedger {
  constructor(private readonly rows: { tool: string; result: unknown }[]) {}
  async find() {
    return null;
  }
  async save() {}
  async listByCall() {
    return [...this.rows];
  }
}

const makeSettingsReader = (settings: OrgSettings | null): SettingsReader => ({
  async getByOrg() {
    return settings;
  },
});

const makeLeadByPhone = (hit: { leadId: LeadId } | null): LeadByPhoneReader => ({
  async findLeadByPhone() {
    return hit;
  },
});

interface Harness {
  deps: RecordCallDeps;
  repo: FakeCallRepo;
  markUnread: ReturnType<typeof vi.fn>;
  createdTasks: { text: string; leadId: LeadId | null }[];
}

const makeHarness = (opts?: {
  ledgerRows?: { tool: string; result: unknown }[];
  settings?: OrgSettings | null;
  leadHit?: { leadId: LeadId } | null;
  createTaskFails?: boolean;
}): Harness => {
  const repo = new FakeCallRepo();
  const createdTasks: { text: string; leadId: LeadId | null }[] = [];
  const markUnread = vi.fn().mockResolvedValue(true);
  const deps: RecordCallDeps = {
    calls: repo,
    ledger: new FakeLedger(opts?.ledgerRows ?? []),
    settings: makeSettingsReader(opts?.settings === undefined ? settingsWith() : opts.settings),
    leadByPhone: makeLeadByPhone(opts?.leadHit === undefined ? { leadId: LEAD } : opts.leadHit),
    unreadMarker: { markLeadUnread: markUnread },
    createTask: {
      async exec(cmd: { text: string; leadId: LeadId | null }) {
        createdTasks.push({ text: cmd.text, leadId: cmd.leadId });
        return opts?.createTaskFails
          ? err(notFound("task failed"))
          : (ok({}) as never);
      },
    } as never,
    clock: { now: () => new Date("2026-07-14T12:00:00Z") },
  };
  return { deps, repo, markUnread, createdTasks };
};

const baseInput = {
  orgId: ORG,
  vapiCallId: "vc-1",
  fromNumber: "+16505550123",
  toNumber: "+16693413343",
  startedAt: new Date("2026-07-14T11:55:00Z"),
  endedAt: new Date("2026-07-14T12:00:00Z"),
  endedReason: "customer-ended-call",
  transcript: "assistant: hi\nuser: bye",
  messages: [
    { role: "assistant", message: "The visit is $89, credited toward the repair." },
    { role: "user", message: "great, book it" },
  ],
  recordingUrl: "https://rec/1.mp3",
  summary: "took a message",
};

describe("RecordCallUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the call with the derived disposition and re-resolved lead", async () => {
    const h = makeHarness({ ledgerRows: [{ tool: "take_message", result: { speak: "ok" } }] });
    await new RecordCallUseCase(h.deps).exec(baseInput);

    expect(h.repo.recorded).toHaveLength(1);
    const rec = h.repo.recorded[0]!;
    expect(rec.disposition).toBe("message");
    expect(rec.leadId).toBe(LEAD);
    expect(rec.priceAudit).toEqual({ flagged: [] });
    expect(h.markUnread).toHaveBeenCalledWith(LEAD, expect.any(Date));
  });

  it("carries a null lead forward when the from-number matches nothing (never blind-clobbers)", async () => {
    const h = makeHarness({ leadHit: null });
    await new RecordCallUseCase(h.deps).exec(baseInput);
    expect(h.repo.recorded[0]!.leadId).toBeNull();
    // No lead → nothing to mark unread.
    expect(h.markUnread).not.toHaveBeenCalled();
  });

  it("flags an unsanctioned spoken price and files a review task", async () => {
    const h = makeHarness();
    await new RecordCallUseCase(h.deps).exec({
      ...baseInput,
      messages: [
        { role: "assistant", message: "The visit is $89." },
        { role: "assistant", message: "The full repair runs about $300." },
      ],
    });

    expect(h.repo.recorded[0]!.priceAudit).toEqual({ flagged: ["$300"] });
    expect(h.createdTasks).toHaveLength(1);
    expect(h.createdTasks[0]!.text).toContain(PRICE_REVIEW_TASK_PREFIX);
    expect(h.createdTasks[0]!.text).toContain("$300");
    expect(h.createdTasks[0]!.leadId).toBe(LEAD);
  });

  it("files NO review task when every spoken price is sanctioned", async () => {
    const h = makeHarness();
    await new RecordCallUseCase(h.deps).exec({
      ...baseInput,
      messages: [
        { role: "assistant", message: "The visit is $89." },
        { role: "assistant", message: "The faucet swap is $150 flat." },
      ],
    });
    expect(h.repo.recorded[0]!.priceAudit).toEqual({ flagged: [] });
    expect(h.createdTasks).toHaveLength(0);
  });

  it("only audits assistant-role lines (a caller saying a price is not a violation)", async () => {
    const h = makeHarness();
    await new RecordCallUseCase(h.deps).exec({
      ...baseInput,
      messages: [
        { role: "user", message: "I was quoted $999 elsewhere." },
        { role: "assistant", message: "The visit is $89." },
      ],
    });
    expect(h.repo.recorded[0]!.priceAudit).toEqual({ flagged: [] });
  });

  it("degrades to a best-effort persist with no audit when settings are missing", async () => {
    const h = makeHarness({ settings: null });
    await new RecordCallUseCase(h.deps).exec({
      ...baseInput,
      messages: [{ role: "assistant", message: "The visit is $89." }],
    });
    // No allowed set → cannot audit; store null priceAudit rather than false-flagging everything.
    expect(h.repo.recorded).toHaveLength(1);
    expect(h.repo.recorded[0]!.priceAudit).toBeNull();
    expect(h.createdTasks).toHaveLength(0);
  });

  it("does not throw when the ledger is empty (no tools ran → no_action)", async () => {
    const h = makeHarness({ ledgerRows: [] });
    await expect(new RecordCallUseCase(h.deps).exec(baseInput)).resolves.toBeUndefined();
    expect(h.repo.recorded[0]!.disposition).toBe("no_action");
  });

  it("still persists the call even if the review-task write fails (no silent swallow, no throw)", async () => {
    const h = makeHarness({ createTaskFails: true });
    await expect(
      new RecordCallUseCase(h.deps).exec({
        ...baseInput,
        messages: [{ role: "assistant", message: "It's $300." }],
      }),
    ).resolves.toBeUndefined();
    expect(h.repo.recorded).toHaveLength(1);
    expect(h.repo.recorded[0]!.priceAudit).toEqual({ flagged: ["$300"] });
  });
});
