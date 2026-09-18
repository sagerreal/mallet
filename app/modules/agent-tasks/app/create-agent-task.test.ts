import { describe, it, expect, beforeEach } from "vitest";
import { asAgentTaskId, asOrgId, asUserId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { AgentMessage } from "@mallet/ai";
import { AgentTask } from "../domain/agent-task";
import type { AgentTaskRepository } from "../domain/agent-task-repository";
import { CreateAgentTaskUseCase } from "./create-agent-task";
import { MAX_OPEN_TASKS_PER_ORG } from "./agent-task-config";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const USER = asUserId("11111111-1111-4111-8111-111111111111");
const MINTED = "ffffffff-ffff-ffff-ffff-ffffffffffff";

class FakeRepo implements Partial<AgentTaskRepository> {
  open = 0;
  lastCreate: Parameters<AgentTaskRepository["create"]>[0] | undefined;
  appended: AgentMessage[] = [];

  async countOpen(): Promise<number> {
    return this.open;
  }
  async create(input: Parameters<AgentTaskRepository["create"]>[0]) {
    this.lastCreate = input;
    const r = AgentTask.create({
      id: asAgentTaskId(input.id), orgId: ORG, title: input.title, status: "working",
      nextActionAt: input.nextActionAt, nextActionNote: null, origin: "chat",
      createdBy: input.createdBy, createdByRole: "owner", version: 0, attempts: 0,
      lastError: null, leaseId: null, lockedUntil: null, transcriptBytes: 0, stepsTaken: 0,
      createdAt: new Date("2026-08-20T17:00:00Z"), updatedAt: new Date("2026-08-20T17:00:00Z"),
      deletedAt: null,
    });
    if (!isOk(r)) throw new Error("fake create built an invalid task");
    return r.value;
  }
  async appendMessage(_id: never, message: AgentMessage): Promise<void> {
    this.appended.push(message);
  }
}

const ids: IdGenerator = { newId: () => MINTED };

describe("CreateAgentTaskUseCase", () => {
  let repo: FakeRepo;
  let uc: CreateAgentTaskUseCase;

  beforeEach(() => {
    repo = new FakeRepo();
    uc = new CreateAgentTaskUseCase(repo as unknown as AgentTaskRepository, new FixedClock(new Date("2026-08-20T17:00:00Z")), ids);
  });

  it("files a task and seeds the instruction as the first message", async () => {
    const r = await uc.exec({
      title: "Follow up with the Hendersons",
      instruction: "Ask whether they want to go ahead with the water heater quote.",
      createdBy: USER,
      createdByRole: "owner",
    });
    expect(isOk(r)).toBe(true);
    expect(repo.lastCreate?.title).toBe("Follow up with the Hendersons");
    expect(repo.lastCreate?.id).toBe(MINTED);
    // Due immediately: the shop asked for it now, so the next tick should pick it up.
    expect(repo.lastCreate?.nextActionAt).toEqual(new Date("2026-08-20T17:00:00Z"));
    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0]).toMatchObject({ role: "user", kind: "text" });
    if (repo.appended[0]?.role === "user" && repo.appended[0].kind === "text") {
      expect(repo.appended[0].text).toContain("water heater quote");
    }
  });

  it("trims title and instruction before storing", async () => {
    const r = await uc.exec({
      title: "  Spaced title  ",
      instruction: "  do the thing  ",
      createdBy: USER,
      createdByRole: "office",
    });
    expect(isOk(r)).toBe(true);
    expect(repo.lastCreate?.title).toBe("Spaced title");
    if (repo.appended[0]?.role === "user" && repo.appended[0].kind === "text") {
      expect(repo.appended[0].text).toBe("do the thing");
    }
  });

  it("refuses an empty instruction without writing anything", async () => {
    const r = await uc.exec({ title: "x", instruction: "   ", createdBy: USER, createdByRole: "owner" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastCreate).toBeUndefined();
    expect(repo.appended).toHaveLength(0);
  });

  it("refuses an instruction over 4000 characters without writing anything", async () => {
    const r = await uc.exec({
      title: "x",
      instruction: "a".repeat(4001),
      createdBy: USER,
      createdByRole: "owner",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.message).toContain("too long");
    }
    expect(repo.lastCreate).toBeUndefined();
  });

  it("refuses a title the aggregate would reject", async () => {
    const r = await uc.exec({ title: "  ", instruction: "do the thing", createdBy: USER, createdByRole: "owner" });
    expect(r.ok).toBe(false);
    expect(repo.lastCreate).toBeUndefined();
  });

  it("refuses a title over the aggregate's max length without writing anything", async () => {
    const r = await uc.exec({
      title: "x".repeat(121),
      instruction: "do the thing",
      createdBy: USER,
      createdByRole: "owner",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastCreate).toBeUndefined();
  });

  it("refuses once the org is at its open-task ceiling", async () => {
    repo.open = MAX_OPEN_TASKS_PER_ORG;
    const r = await uc.exec({ title: "one more", instruction: "go", createdBy: USER, createdByRole: "owner" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("conflict");
      expect(r.error.message).toContain(String(MAX_OPEN_TASKS_PER_ORG));
    }
    expect(repo.lastCreate).toBeUndefined();
  });

  it("allows filing right up to one below the open-task ceiling", async () => {
    repo.open = MAX_OPEN_TASKS_PER_ORG - 1;
    const r = await uc.exec({ title: "just under", instruction: "go", createdBy: USER, createdByRole: "owner" });
    expect(isOk(r)).toBe(true);
  });

  it("refuses a tech — the employee is an office surface", async () => {
    const r = await uc.exec({ title: "t", instruction: "go", createdBy: USER, createdByRole: "tech" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unauthorized");
    expect(repo.lastCreate).toBeUndefined();
  });

  it("allows an office-role creator, not just owner", async () => {
    const r = await uc.exec({ title: "t", instruction: "go", createdBy: USER, createdByRole: "office" });
    expect(isOk(r)).toBe(true);
  });
});
