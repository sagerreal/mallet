import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asLeadId, isOk, money, FixedClock } from "@mallet/shared/types";
import { PipelineStage } from "../domain/pipeline-stage";
import type { PipelineStageRepository } from "../domain/pipeline-stage-repository";
import { Lead } from "../domain/lead";
import {
  CreatePipelineStageUseCase,
  RenamePipelineStageUseCase,
  RemovePipelineStageUseCase,
  MovePipelineStageUseCase,
  SeedPipelineStagesUseCase,
  SetLeadPipelineStageUseCase,
  PIPELINE_TEMPLATES,
} from "./pipeline-stages";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-19T12:00:00Z");

class FakeStageRepo implements PipelineStageRepository {
  store = new Map<string, PipelineStage>();
  async list(): Promise<PipelineStage[]> {
    return [...this.store.values()]
      .filter((s) => s.props.deletedAt === null)
      .sort((a, b) => a.props.position - b.props.position || +a.props.createdAt - +b.props.createdAt);
  }
  async findById(id: string): Promise<PipelineStage | null> {
    const s = this.store.get(id);
    return s && s.props.deletedAt === null ? s : null;
  }
  async save(stage: PipelineStage): Promise<void> {
    this.store.set(stage.props.id, stage);
  }
}

const seqIds = () => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}` };
};

const makeLead = (over: Partial<Parameters<typeof Lead.create>[0]> = {}) => {
  const r = Lead.create({
    id: asLeadId("33333333-3333-3333-3333-333333333333"),
    orgId: ORG, name: "Marta Feldkamp", phone: null, email: null, customFields: null,
    source: null, tags: [], stage: "new", value: money(0), unread: false, wonAt: null,
    companyId: null, role: null, notes: null, lossReason: null,
    pipelineStageId: null, address: null, createdAt: NOW, updatedAt: NOW, ...over,
  });
  if (!r.ok) throw new Error("lead seed failed");
  return r.value;
};

let repo: FakeStageRepo;
let clock: FixedClock;
let ids: ReturnType<typeof seqIds>;
beforeEach(() => {
  repo = new FakeStageRepo();
  clock = new FixedClock(NOW);
  ids = seqIds();
});

const create = (name: string) => new CreatePipelineStageUseCase(repo, ORG, clock, ids).exec({ name });

describe("CreatePipelineStageUseCase", () => {
  it("appends at the end — a new stage lands after the shop's existing order", async () => {
    await create("New lead");
    await create("Contacted");
    const r = await create("Won");
    expect(isOk(r) && r.value.props.position).toBe(2);
  });

  it("rejects a blank name at the boundary, before any write", async () => {
    const r = await create("   ");
    expect(r.ok).toBe(false);
    expect(repo.store.size).toBe(0);
  });

  it("caps the board — a pipeline with dozens of columns is a spreadsheet, not a board", async () => {
    for (let i = 0; i < 12; i += 1) await create(`Stage ${i}`);
    expect((await repo.list()).length).toBe(12);
    expect((await create("one too many")).ok).toBe(false);
  });
});

describe("RenamePipelineStageUseCase", () => {
  it("renames a live stage", async () => {
    const made = await create("Contcted");
    if (!isOk(made)) throw new Error("seed");
    const r = await new RenamePipelineStageUseCase(repo, clock).exec({ id: made.value.props.id, name: "Contacted" });
    expect(isOk(r) && r.value.props.name).toBe("Contacted");
  });

  it("says not_found for a stage that does not exist — not a silent no-op", async () => {
    const r = await new RenamePipelineStageUseCase(repo, clock).exec({ id: "99999999-9999-9999-9999-999999999999", name: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("RemovePipelineStageUseCase", () => {
  it("soft-deletes — the stage stops listing but the row survives", async () => {
    const made = await create("Old step");
    if (!isOk(made)) throw new Error("seed");
    const r = await new RemovePipelineStageUseCase(repo, clock).exec({ id: made.value.props.id });
    expect(r.ok).toBe(true);
    expect(await repo.list()).toHaveLength(0);
    expect(repo.store.size).toBe(1);
  });
});

describe("MovePipelineStageUseCase", () => {
  it("swaps with the neighbour in the given direction", async () => {
    const a = await create("A"); const b = await create("B");
    if (!isOk(a) || !isOk(b)) throw new Error("seed");
    const r = await new MovePipelineStageUseCase(repo, clock).exec({ id: b.value.props.id, direction: "up" });
    expect(r.ok).toBe(true);
    const names = (await repo.list()).map((s) => s.props.name);
    expect(names).toEqual(["B", "A"]);
  });

  it("moving the first stage up is a graceful no-op, not an error", async () => {
    const a = await create("A"); await create("B");
    if (!isOk(a)) throw new Error("seed");
    const r = await new MovePipelineStageUseCase(repo, clock).exec({ id: a.value.props.id, direction: "up" });
    expect(r.ok).toBe(true);
    expect((await repo.list()).map((s) => s.props.name)).toEqual(["A", "B"]);
  });
});

describe("SeedPipelineStagesUseCase", () => {
  it("creates the template's stages in order", async () => {
    const r = await new SeedPipelineStagesUseCase(repo, ORG, clock, ids).exec({ template: "sales" });
    expect(isOk(r) && r.value.map((s) => s.props.name)).toEqual([...PIPELINE_TEMPLATES.sales]);
  });

  it("is idempotent — a second seed (double-click, retry) returns the existing stages untouched", async () => {
    await new SeedPipelineStagesUseCase(repo, ORG, clock, ids).exec({ template: "sales" });
    const again = await new SeedPipelineStagesUseCase(repo, ORG, clock, ids).exec({ template: "insurance" });
    expect(isOk(again) && again.value.map((s) => s.props.name)).toEqual([...PIPELINE_TEMPLATES.sales]);
    expect(repo.store.size).toBe(PIPELINE_TEMPLATES.sales.length);
  });
});

describe("SetLeadPipelineStageUseCase", () => {
  const leadStore = new Map<string, Lead>();
  const leadRepo = {
    findById: async (id: string) => leadStore.get(id) ?? null,
    save: async (l: Lead) => void leadStore.set(l.props.id, l),
  };

  beforeEach(() => leadStore.clear());

  it("places the lead in a live stage", async () => {
    const made = await create("Follow-up");
    if (!isOk(made)) throw new Error("seed");
    const lead = makeLead();
    leadStore.set(lead.props.id, lead);
    const uc = new SetLeadPipelineStageUseCase(leadRepo, repo, clock);
    const r = await uc.exec({ leadId: lead.props.id, stageId: made.value.props.id });
    expect(isOk(r) && r.value.props.pipelineStageId).toBe(made.value.props.id);
  });

  it("null clears the placement — dragging back to the unstaged column", async () => {
    const made = await create("Follow-up");
    if (!isOk(made)) throw new Error("seed");
    const lead = makeLead().setPipelineStage(made.value.props.id, NOW);
    leadStore.set(lead.props.id, lead);
    const r = await new SetLeadPipelineStageUseCase(leadRepo, repo, clock).exec({ leadId: lead.props.id, stageId: null });
    expect(isOk(r) && r.value.props.pipelineStageId).toBe(null);
  });

  it("refuses a stage that does not exist or was removed — the write names the problem", async () => {
    const lead = makeLead();
    leadStore.set(lead.props.id, lead);
    const r = await new SetLeadPipelineStageUseCase(leadRepo, repo, clock)
      .exec({ leadId: lead.props.id, stageId: "99999999-9999-9999-9999-999999999999" });
    expect(r.ok).toBe(false);
    expect(leadStore.get(lead.props.id)?.props.pipelineStageId).toBe(null);
  });
});
