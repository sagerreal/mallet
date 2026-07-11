import { describe, it, expect, beforeEach } from "vitest";
import { asJobId, asOrgId, FixedClock, isOk, isErr, type JobId } from "@mallet/shared/types";
import { JobLine, JobAddon, JobVerifyAnswer, JobPhoto } from "../domain/job-execution";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";
import {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "./job-execution-use-cases";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING: JobId = asJobId("99999999-9999-9999-9999-999999999999");

// A fake job aggregate is enough for these use-cases — they only read findById !== null.
const fakeJob = { props: { id: JOB } } as unknown as Job;

class FakeRepo implements Partial<JobRepository> {
  jobs = new Map<string, Job>([[JOB, fakeJob]]);
  lines: JobLine[] = [];
  addons: JobAddon[] = [];
  answers: JobVerifyAnswer[] = [];
  photos: JobPhoto[] = [];

  async findById(id: JobId): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async listExecution(): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }> {
    return { lines: this.lines, addons: this.addons, verifyAnswers: this.answers, photos: this.photos };
  }
  async addLine(line: JobLine): Promise<void> {
    this.lines.push(line);
  }
  async updateLine(line: JobLine): Promise<number> {
    const i = this.lines.findIndex((l) => l.props.id === line.props.id);
    if (i < 0) return 0;
    this.lines[i] = line;
    return 1;
  }
  async removeLine(_j: JobId, lineId: string): Promise<number> {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.props.id !== lineId);
    return before - this.lines.length;
  }
  async addAddon(addon: JobAddon): Promise<void> {
    this.addons.push(addon);
  }
  async setAddonStatus(_j: JobId, addonId: string): Promise<number> {
    return this.addons.some((a) => a.props.id === addonId) ? 1 : 0;
  }
  async setAddonInvoiceSkip(_j: JobId, addonId: string): Promise<number> {
    return this.addons.some((a) => a.props.id === addonId) ? 1 : 0;
  }
  async upsertVerifyAnswer(answer: JobVerifyAnswer): Promise<void> {
    this.answers.push(answer);
  }
  async removeVerifyAnswer(_j: JobId, itemId: number): Promise<number> {
    const before = this.answers.length;
    this.answers = this.answers.filter((a) => a.props.itemId !== itemId);
    return before - this.answers.length;
  }
  async addPhoto(photo: JobPhoto): Promise<void> {
    this.photos.push(photo);
  }
  async removePhoto(_j: JobId, photoId: string): Promise<number> {
    const before = this.photos.length;
    this.photos = this.photos.filter((p) => p.props.id !== photoId);
    return before - this.photos.length;
  }
}

const ids = (id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") => ({ newId: () => id });

describe("job execution use-cases", () => {
  let repo: FakeRepo;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeRepo();
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
  });

  it("AddJobLine inserts and returns the job + execution with the new line", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "Panel swap", quantity: 1, rateCents: 5000, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.lines).toHaveLength(1);
  });

  it("AddJobLine on a missing job returns not_found", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: MISSING, description: "x", quantity: 1, rateCents: 100, costCents: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("AddJobLine rejects an empty description (validation)", async () => {
    const uc = new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "  ", quantity: 1, rateCents: 100, costCents: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("UpdateJobLine on an unknown line returns not_found", async () => {
    const uc = new UpdateJobLineUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, lineId: "nope", description: "x", quantity: 1, rateCents: 100, costCents: 0, position: 0 }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("RemoveJobLine deletes and returns the job", async () => {
    await new AddJobLineUseCase(repo as unknown as JobRepository, clock, ids("line-1")).exec(
      { jobId: JOB, description: "L", quantity: 1, rateCents: 100, costCents: 0 },
      ORG,
    );
    const r = await new RemoveJobLineUseCase(repo as unknown as JobRepository, clock).exec({ jobId: JOB, lineId: "line-1" }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.lines).toHaveLength(0);
  });

  it("AddJobAddon inserts a proposed addon", async () => {
    const uc = new AddJobAddonUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, description: "Extra outlet", quantity: 1, rateCents: 9000, costCents: 0 }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.addons[0]?.props.status).toBe("proposed");
  });

  it("SetAddonStatus on a missing addon returns not_found", async () => {
    const uc = new SetAddonStatusUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, addonId: "missing", status: "approved" }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("SetAddonInvoiceSkip on a missing addon returns not_found", async () => {
    const uc = new SetAddonInvoiceSkipUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, addonId: "missing", invoiceSkip: true }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("SetVerifyAnswer with state=pass upserts an answer", async () => {
    const uc = new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, itemId: 3, state: "pass", via: "manual", reason: null }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.verifyAnswers).toHaveLength(1);
  });

  it("SetVerifyAnswer with state=override and no reason is validation", async () => {
    const uc = new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, itemId: 3, state: "override", via: null, reason: " " }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("SetVerifyAnswer with state=clear removes the answer", async () => {
    await new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock).exec(
      { jobId: JOB, itemId: 3, state: "pass", via: "manual", reason: null },
      ORG,
    );
    const r = await new SetVerifyAnswerUseCase(repo as unknown as JobRepository, clock).exec(
      { jobId: JOB, itemId: 3, state: "clear", via: null, reason: null },
      ORG,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.verifyAnswers).toHaveLength(0);
  });

  it("AddJobPhoto records the metadata row", async () => {
    const uc = new AddJobPhotoUseCase(repo as unknown as JobRepository, clock, ids());
    const r = await uc.exec({ jobId: JOB, storagePath: `${ORG}/${JOB}/p.jpg`, caption: null, verifyPass: true }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.execution.photos).toHaveLength(1);
  });

  it("AddJobPhoto rejects a storagePath outside the job's own org/job folder", async () => {
    const uc = new AddJobPhotoUseCase(repo as unknown as JobRepository, clock, ids());
    // A forged path pointing at another org's folder must be rejected before any write.
    const r = await uc.exec(
      { jobId: JOB, storagePath: `99999999-9999-9999-9999-999999999999/${JOB}/p.jpg`, caption: null, verifyPass: true },
      ORG,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("RemoveJobPhoto on a missing photo returns not_found", async () => {
    const uc = new RemoveJobPhotoUseCase(repo as unknown as JobRepository, clock);
    const r = await uc.exec({ jobId: JOB, photoId: "missing" }, ORG);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
