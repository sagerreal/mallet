import { describe, it, expect, beforeEach } from "vitest";
import {
  asChecklistId,
  asChecklistItemId,
  asOrgId,
  FixedClock,
  isOk,
  type ChecklistId,
  type ChecklistItemId,
  type OrgId,
} from "@mallet/shared/types";
import { Checklist, ChecklistItem, type ChecklistProps } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";
import { CreateChecklistUseCase, type CreateChecklistCommand } from "./create-checklist";

// ── constants ──────────────────────────────────────────────────────────────────

export const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const MINTED = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ────────────────────────────────────────────────────────────────────

export const baseProps = (over: Partial<ChecklistProps> = {}): ChecklistProps => ({
  id: asChecklistId(MINTED),
  orgId: ORG,
  name: "Water heater",
  trade: "Custom",
  stage: "job",
  match: [],
  items: [],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...over,
});

// ── FakeChecklistRepository ────────────────────────────────────────────────────

export class FakeChecklistRepository implements ChecklistRepository {
  readonly store = new Map<ChecklistId, Checklist>();
  lastCreatedInput: Parameters<ChecklistRepository["create"]>[0] | undefined;
  lastAddedInput: Parameters<ChecklistRepository["addItem"]>[0] | undefined;

  async create(input: Parameters<ChecklistRepository["create"]>[0]): Promise<Checklist> {
    this.lastCreatedInput = input;
    const r = Checklist.create(baseProps({
      id: asChecklistId(input.id),
      orgId: asOrgId(input.orgId),
      name: input.name,
      trade: input.trade,
      stage: input.stage,
      match: input.match,
    }));
    if (!isOk(r)) throw new Error(`fake create failed: ${r.error.message}`);
    this.store.set(r.value.props.id, r.value);
    return r.value;
  }

  async findById(id: ChecklistId): Promise<Checklist | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<{ items: Checklist[]; nextCursor: string | null }> {
    return { items: [...this.store.values()], nextCursor: null };
  }

  async archive(id: ChecklistId): Promise<number> {
    return this.store.delete(id) ? 1 : 0;
  }

  async addItem(input: Parameters<ChecklistRepository["addItem"]>[0]): Promise<Checklist> {
    this.lastAddedInput = input;
    const template = this.store.get(input.templateId);
    if (!template) throw new Error("fake addItem: template not found");
    // Append for real so item-count invariants (e.g. the ≤ 50 cap) are observable.
    const item = ChecklistItem.create({
      id: input.id,
      text: input.text,
      type: input.type,
      required: input.required,
      position: input.position,
    });
    if (!isOk(item)) throw new Error(`fake addItem produced an invalid item: ${item.error.message}`);
    const updated = template.withItems(
      [...template.props.items, item.value],
      new Date("2026-07-01T00:00:00Z"),
    );
    this.store.set(updated.props.id, updated);
    return updated;
  }

  async removeItem(templateId: ChecklistId, _itemId: ChecklistItemId): Promise<Checklist | null> {
    return this.store.get(templateId) ?? null;
  }

  async setItemRequired(
    templateId: ChecklistId,
    _itemId: ChecklistItemId,
    _required: boolean,
  ): Promise<Checklist | null> {
    return this.store.get(templateId) ?? null;
  }
}

// ── CreateChecklistUseCase ─────────────────────────────────────────────────────

describe("CreateChecklistUseCase", () => {
  let clock: FixedClock;
  let repo: FakeChecklistRepository;
  let useCase: CreateChecklistUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeChecklistRepository();
    useCase = new CreateChecklistUseCase(repo, clock, { newId: () => MINTED });
  });

  it("rejects an empty name without calling the repo", async () => {
    const cmd: CreateChecklistCommand = { name: "  ", trade: "Custom", stage: "job", match: [] };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastCreatedInput).toBeUndefined();
  });

  it("rejects an unknown stage", async () => {
    const cmd = { name: "x", trade: "Custom", stage: "invoice", match: [] } as unknown as CreateChecklistCommand;
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("mints an id when none provided and passes trimmed name + org", async () => {
    const cmd: CreateChecklistCommand = { name: "  Repipe  ", trade: "Plumbing", stage: "scope", match: ["repipe"] };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.lastCreatedInput?.id).toBe(MINTED);
    expect(repo.lastCreatedInput?.name).toBe("Repipe");
    expect(repo.lastCreatedInput?.orgId).toBe(ORG);
    expect(repo.lastCreatedInput?.stage).toBe("scope");
  });

  it("uses a caller-provided id", async () => {
    const cmd: CreateChecklistCommand = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "x",
      trade: "Custom",
      stage: "job",
      match: [],
    };
    await useCase.exec(cmd, ORG);
    expect(repo.lastCreatedInput?.id).toBe("11111111-1111-1111-1111-111111111111");
  });
});
