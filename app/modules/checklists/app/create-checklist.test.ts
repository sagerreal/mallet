import { describe, it, expect, beforeEach } from "vitest";
import {
  asChecklistId,
  asOrgId,
  FixedClock,
  isOk,
  type ChecklistId,
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

  async create(input: Parameters<ChecklistRepository["create"]>[0]): Promise<Checklist> {
    this.lastCreatedInput = input;
    // Build initial items for real so the atomic create-with-items path is observable.
    const items = (input.items ?? []).map((it) => {
      const r = ChecklistItem.create(it);
      if (!isOk(r)) throw new Error(`fake create produced an invalid item: ${r.error.message}`);
      return r.value;
    });
    const r = Checklist.create(baseProps({
      id: asChecklistId(input.id),
      orgId: asOrgId(input.orgId),
      name: input.name,
      trade: input.trade,
      stage: input.stage,
      match: input.match,
      items,
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

  async update(input: Parameters<ChecklistRepository["update"]>[0]): Promise<Checklist | null> {
    const existing = this.store.get(input.id);
    if (!existing) return null;
    const items = (input.items ?? []).map((it) => {
      const r = ChecklistItem.create(it);
      if (!isOk(r)) throw new Error(`fake update produced an invalid item: ${r.error.message}`);
      return r.value;
    });
    const r = Checklist.create({ ...existing.props, name: input.name, items });
    if (!isOk(r)) throw new Error(`fake update failed: ${r.error.message}`);
    this.store.set(r.value.props.id, r.value);
    return r.value;
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

  it("creates initial items atomically: trimmed, positioned, required flag kept", async () => {
    const cmd: CreateChecklistCommand = {
      name: "Water heater close-out",
      trade: "Custom",
      stage: "job",
      match: [],
      items: [
        { text: "  Photo of the install  ", type: "photo", required: true },
        { text: "T&P valve tested", type: "check" },
      ],
    };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.items).toHaveLength(2);
    expect(r.value.props.items[0]!.props).toMatchObject({
      text: "Photo of the install",
      type: "photo",
      required: true,
      position: 0,
    });
    expect(r.value.props.items[1]!.props).toMatchObject({
      text: "T&P valve tested",
      type: "check",
      required: false,
      position: 1,
    });
  });

  it("rejects a create whose items exceed the 50-item cap", async () => {
    const cmd: CreateChecklistCommand = {
      name: "Too big",
      trade: "Custom",
      stage: "job",
      match: [],
      items: Array.from({ length: 51 }, (_, i) => ({ text: `Item ${i}`, type: "check" as const })),
    };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastCreatedInput).toBeUndefined();
  });

  it("rejects duplicate client-supplied item ids without calling the repo (validation, not a PK 500)", async () => {
    const dup = "33333333-3333-3333-3333-333333333333";
    const cmd: CreateChecklistCommand = {
      name: "Dup ids",
      trade: "Custom",
      stage: "job",
      match: [],
      items: [
        { id: dup, text: "First", type: "check" },
        { id: dup, text: "Second", type: "check" },
      ],
    };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastCreatedInput).toBeUndefined();
  });

  it("rejects an empty item text without calling the repo", async () => {
    const cmd: CreateChecklistCommand = {
      name: "x",
      trade: "Custom",
      stage: "job",
      match: [],
      items: [{ text: "   ", type: "check" }],
    };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    expect(repo.lastCreatedInput).toBeUndefined();
  });
});
