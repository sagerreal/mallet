import { describe, it, expect, beforeEach, vi } from "vitest";
import { asChecklistId, asChecklistItemId, asOrgId, isOk } from "@mallet/shared/types";
import { Checklist, ChecklistItem, type ChecklistProps } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";
import type { ChecklistId } from "@mallet/shared/types";
import { UpdateChecklistUseCase } from "./update-checklist";

// ── constants ──────────────────────────────────────────────────────────────────

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const CHECKLIST_ID = asChecklistId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const MINTED = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ────────────────────────────────────────────────────────────────────

const baseProps = (over: Partial<ChecklistProps> = {}): ChecklistProps => ({
  id: CHECKLIST_ID,
  orgId: ORG,
  name: "Water heater",
  trade: "Plumbing",
  stage: "job",
  match: ["water heater"],
  items: [],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...over,
});

const makeChecklist = (over: Partial<ChecklistProps> = {}): Checklist => {
  const r = Checklist.create(baseProps(over));
  if (!isOk(r)) throw new Error(`test helper: ${r.error.message}`);
  return r.value;
};

const makeItem = (text: string, position: number): ChecklistItem => {
  const r = ChecklistItem.create({
    id: asChecklistItemId(`item-${position}-${text.replace(/\s/g, "-")}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`.slice(0, 36)),
    text,
    type: "check",
    required: false,
    position,
  });
  if (!isOk(r)) throw new Error(`test helper: ${r.error.message}`);
  return r.value;
};

// ── FakeChecklistRepository ────────────────────────────────────────────────────

class FakeChecklistRepository implements ChecklistRepository {
  readonly store = new Map<ChecklistId, Checklist>();
  updateCallCount = 0;
  lastUpdateInput: Parameters<ChecklistRepository["update"]>[0] | undefined;

  // Return a checklist with updated name + items when update is called.
  async update(input: Parameters<ChecklistRepository["update"]>[0]): Promise<Checklist | null> {
    this.updateCallCount++;
    this.lastUpdateInput = input;
    const existing = this.store.get(input.id);
    if (!existing) return null;
    const items = input.items.map((it) => {
      const r = ChecklistItem.create(it);
      if (!isOk(r)) throw new Error(`fake update produced an invalid item: ${r.error.message}`);
      return r.value;
    });
    const r = Checklist.create({
      ...existing.props,
      name: input.name,
      items,
      updatedAt: new Date(),
    });
    if (!isOk(r)) throw new Error(`fake update produced an invalid checklist: ${r.error.message}`);
    const updated = r.value;
    this.store.set(input.id, updated);
    return updated;
  }

  async create(input: Parameters<ChecklistRepository["create"]>[0]): Promise<Checklist> {
    const r = Checklist.create(baseProps({ id: asChecklistId(input.id), name: input.name }));
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
}

// ── UpdateChecklistUseCase ─────────────────────────────────────────────────────

describe("UpdateChecklistUseCase", () => {
  let repo: FakeChecklistRepository;
  let useCase: UpdateChecklistUseCase;

  beforeEach(() => {
    repo = new FakeChecklistRepository();
    useCase = new UpdateChecklistUseCase(repo, { newId: () => MINTED });
    // Seed a checklist to update.
    repo.store.set(CHECKLIST_ID, makeChecklist({
      items: [makeItem("Old item 1", 0), makeItem("Old item 2", 1)],
    }));
  });

  it("replaces name + items; repo.update is called once with minted-id/positioned items in order", async () => {
    const r = await useCase.exec(
      {
        checklistId: CHECKLIST_ID,
        name: "New name",
        items: [
          { text: "Step A", type: "check" },
          { text: "Step B", type: "photo", required: true },
        ],
      },
      ORG,
    );

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.name).toBe("New name");
    expect(r.value.props.items).toHaveLength(2);

    expect(repo.updateCallCount).toBe(1);
    const passedItems = repo.lastUpdateInput?.items;
    expect(passedItems).toHaveLength(2);
    expect(passedItems?.[0]).toMatchObject({ text: "Step A", type: "check", required: false, position: 0 });
    expect(passedItems?.[1]).toMatchObject({ text: "Step B", type: "photo", required: true, position: 1 });
    // IDs should be minted (since none were supplied by caller).
    expect(passedItems?.[0]?.id).toBe(MINTED);
    expect(passedItems?.[1]?.id).toBe(MINTED);
  });

  it("rejects >50 items with a validation error; repo.update is NOT called", async () => {
    const r = await useCase.exec(
      {
        checklistId: CHECKLIST_ID,
        name: "Too many items",
        items: Array.from({ length: 51 }, (_, i) => ({ text: `Item ${i}`, type: "check" as const })),
      },
      ORG,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.updateCallCount).toBe(0);
  });

  it("rejects an item with an invalid type; repo.update is NOT called", async () => {
    const r = await useCase.exec(
      {
        checklistId: CHECKLIST_ID,
        name: "Bad type",
        // Force an invalid type via unknown cast (simulates bad API input that escaped Zod).
        items: [{ text: "Step A", type: "fax" as unknown as "check" }],
      },
      ORG,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.updateCallCount).toBe(0);
  });

  it("returns a notFound error when repo returns null (template not found)", async () => {
    const unknownId = asChecklistId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const r = await useCase.exec(
      { checklistId: unknownId, name: "Ghost", items: [{ text: "Step", type: "check" }] },
      ORG,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("trims whitespace from name and item text before validation", async () => {
    const r = await useCase.exec(
      {
        checklistId: CHECKLIST_ID,
        name: "  Trimmed Name  ",
        items: [{ text: "  Trimmed item  ", type: "check" }],
      },
      ORG,
    );

    expect(isOk(r)).toBe(true);
    expect(repo.lastUpdateInput?.name).toBe("Trimmed Name");
    expect(repo.lastUpdateInput?.items[0]?.text).toBe("Trimmed item");
  });

  it("rejects an empty name; repo.update is NOT called", async () => {
    const r = await useCase.exec(
      { checklistId: CHECKLIST_ID, name: "   ", items: [{ text: "Step", type: "check" }] },
      ORG,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.updateCallCount).toBe(0);
  });
});
