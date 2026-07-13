import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asUserId,
  asServiceId,
  FixedClock,
  isOk,
  type OrgId,
  type QuotingRuleId,
} from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { matchRules, type RuleCandidate } from "../domain/rule-match";
import { CreateQuotingRuleUseCase } from "./create-quoting-rule";
import { ConfirmQuotingRuleUseCase } from "./confirm-quoting-rule";
import { DismissQuotingRuleUseCase } from "./dismiss-quoting-rule";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const AUTHOR = asUserId("44444444-4444-4444-4444-444444444444");
const NOW = new Date("2026-07-13T12:00:00Z");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

class FakeQuotingRuleRepository implements QuotingRuleRepository {
  readonly store = new Map<QuotingRuleId, QuotingRule>();

  async save(rule: QuotingRule): Promise<void> {
    this.store.set(rule.props.id, rule);
  }
  async findById(id: QuotingRuleId): Promise<QuotingRule | null> {
    return this.store.get(id) ?? null;
  }
  async listConfirmed(): Promise<QuotingRule[]> {
    return [...this.store.values()]
      .filter((r) => r.props.status === "confirmed" && r.isActive())
      .sort((a, b) => b.props.timesConfirmed - a.props.timesConfirmed);
  }
  async listProposed(): Promise<QuotingRule[]> {
    return [...this.store.values()].filter(
      (r) =>
        r.props.status === "proposed" &&
        r.isActive() &&
        (r.props.source !== "edit_delta" || r.props.timesConfirmed >= 2),
    );
  }
  async findMatching(jobText: string, limit?: number): Promise<RuleCandidate[]> {
    const candidates = (await this.listConfirmed()).map((rule) => ({ rule, serviceName: null }));
    return matchRules(jobText, candidates, limit);
  }
  async listProposedEditDeltas(): Promise<QuotingRule[]> {
    return [...this.store.values()].filter(
      (r) => r.props.status === "proposed" && r.props.source === "edit_delta" && r.isActive(),
    );
  }
}

let repo: FakeQuotingRuleRepository;
let create: CreateQuotingRuleUseCase;
let confirm: ConfirmQuotingRuleUseCase;
let dismiss: DismissQuotingRuleUseCase;

beforeEach(() => {
  repo = new FakeQuotingRuleRepository();
  const clock = new FixedClock(NOW);
  create = new CreateQuotingRuleUseCase(repo, clock, seqIds());
  confirm = new ConfirmQuotingRuleUseCase(repo, clock);
  dismiss = new DismissQuotingRuleUseCase(repo, clock);
});

const baseCmd = {
  orgId: ORG,
  authorUserId: AUTHOR,
  rule: "Add haul-away on water heater swaps",
  jobTag: "water heater",
  source: "manual" as const,
};

describe("CreateQuotingRuleUseCase", () => {
  it("owner and office rules land confirmed immediately", async () => {
    const asOwner = await create.exec({ ...baseCmd, role: "owner" });
    expect(isOk(asOwner) && asOwner.value.props.status).toBe("confirmed");

    const asOffice = await create.exec({ ...baseCmd, role: "office", jobTag: "sewer camera" });
    expect(isOk(asOffice) && asOffice.value.props.status).toBe("confirmed");
  });

  it("a rule overlapping an existing confirmed one lands proposed (contradiction review)", async () => {
    await create.exec({ ...baseCmd, role: "owner" });
    const overlapping = await create.exec({
      ...baseCmd,
      role: "owner",
      rule: "Never include haul-away on heater swaps",
      jobTag: "heater swap",
    });
    expect(isOk(overlapping) && overlapping.value.props.status).toBe("proposed");
  });

  it("same-service rules overlap too", async () => {
    const svc = asServiceId("00000000-0000-0000-0000-0000000000aa");
    await create.exec({ ...baseCmd, role: "owner", jobTag: null, serviceId: svc });
    const second = await create.exec({
      ...baseCmd,
      role: "owner",
      rule: "Different take on the same service",
      jobTag: null,
      serviceId: svc,
    });
    expect(isOk(second) && second.value.props.status).toBe("proposed");
  });

  it("non-office roles can only propose (defense-in-depth)", async () => {
    const asTech = await create.exec({ ...baseCmd, role: "tech" });
    expect(isOk(asTech) && asTech.value.props.status).toBe("proposed");
  });

  it("propagates domain validation (empty rule)", async () => {
    const result = await create.exec({ ...baseCmd, role: "owner", rule: "   " });
    expect(result.ok).toBe(false);
  });
});

describe("ConfirmQuotingRuleUseCase", () => {
  it("promotes a proposal and supersedes the overlapping confirmed rule", async () => {
    const first = await create.exec({ ...baseCmd, role: "owner" });
    if (!isOk(first)) throw new Error("setup");
    const second = await create.exec({
      ...baseCmd,
      role: "owner",
      rule: "Haul-away is billed as its own line",
      jobTag: "heater",
    });
    if (!isOk(second)) throw new Error("setup");
    expect(second.value.props.status).toBe("proposed");

    const promoted = await confirm.exec({ ruleId: second.value.props.id });
    expect(isOk(promoted) && promoted.value.props.status).toBe("confirmed");

    const old = await repo.findById(first.value.props.id);
    expect(old?.isActive()).toBe(false);
    expect(old?.props.supersededBy).toBe(second.value.props.id);
    // Exactly one live rule for the scope now.
    expect(await repo.listConfirmed()).toHaveLength(1);
  });

  it("returns not_found for an unknown rule", async () => {
    const result = await confirm.exec({ ruleId: "00000000-0000-0000-0000-00000000dead" as QuotingRuleId });
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

describe("DismissQuotingRuleUseCase", () => {
  it("invalidates a rule (proposal dismiss / confirmed forget)", async () => {
    const created = await create.exec({ ...baseCmd, role: "owner" });
    if (!isOk(created)) throw new Error("setup");
    const dismissed = await dismiss.exec({ ruleId: created.value.props.id });
    expect(isOk(dismissed) && dismissed.value.isActive()).toBe(false);
    expect(await repo.listConfirmed()).toHaveLength(0);
  });

  it("returns not_found for an unknown rule", async () => {
    const result = await dismiss.exec({ ruleId: "00000000-0000-0000-0000-00000000dead" as QuotingRuleId });
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});
