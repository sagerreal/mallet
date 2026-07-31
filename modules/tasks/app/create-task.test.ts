import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asTaskId,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type TaskId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { type IdGenerator } from "@mallet/shared/ports";
import { Task } from "../domain/task";
import type { TaskRepository, TaskFilter } from "../domain/task-repository";
import { CreateTaskUseCase, type CreateTaskCommand } from "./create-task";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

/** Sequential IdGenerator — yields "id-1", "id-2", … for deterministic assertions. */
const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

// ---------------------------------------------------------------------------
// Minimal in-memory TaskRepository — only create() is exercised by the use-case;
// the other methods satisfy the interface.
// ---------------------------------------------------------------------------

class FakeTaskRepository implements TaskRepository {
  async count(): Promise<number> { return 0; }
  readonly created: Task[] = [];
  private readonly saved: Task[] = [];

  async create(input: {
    id: string;
    orgId: string;
    leadId: string | null;
    text: string;
    dueDate: string | null;
  }): Promise<Task> {
    const now = new Date("2026-07-09T00:00:00Z");
    const result = Task.create({
      id: asTaskId(input.id),
      orgId: asOrgId(input.orgId),
      leadId: input.leadId ? asLeadId(input.leadId) : null,
      text: input.text,
      dueDate: input.dueDate,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(result)) throw new Error(`FakeTaskRepository.create: ${result.error.message}`);
    const task = result.value;
    this.created.push(task);
    return task;
  }

  async findById(id: TaskId): Promise<Task | null> {
    return this.created.find((t) => t.props.id === id) ?? null;
  }

  async list(_page: CursorPage, _filter?: TaskFilter): Promise<Paginated<Task>> {
    return { items: this.created, nextCursor: null };
  }

  async save(task: Task): Promise<void> {
    this.saved.push(task);
  }

  async remove(_id: TaskId, _now: Date): Promise<number> {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateTaskUseCase", () => {
  let clock: FixedClock;
  let repo: FakeTaskRepository;
  let ids: IdGenerator;
  let useCase: CreateTaskUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T00:00:00Z"));
    repo = new FakeTaskRepository();
    ids = seqIds();
    useCase = new CreateTaskUseCase(repo, clock, ids);
  });

  // ── validation ────────────────────────────────────────────────────────────

  it("returns a validation error when text is empty", async () => {
    const cmd: CreateTaskCommand = { text: "", leadId: null, dueDate: null };
    const result = await useCase.exec(cmd, ORG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind === "validation") expect(result.error.field).toBe("text");
  });

  it("returns a validation error when text is only whitespace", async () => {
    const cmd: CreateTaskCommand = { text: "   ", leadId: null, dueDate: null };
    const result = await useCase.exec(cmd, ORG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    if (result.error.kind === "validation") expect(result.error.field).toBe("text");
  });

  it("does not persist when text validation fails", async () => {
    await useCase.exec({ text: "  ", leadId: null, dueDate: null }, ORG);
    expect(repo.created).toHaveLength(0);
  });

  // ── id-minting branch: no id provided ────────────────────────────────────

  it("mints a new id when the command does not supply one", async () => {
    const cmd: CreateTaskCommand = { text: "Send the invoice", leadId: null, dueDate: null };
    const result = await useCase.exec(cmd, ORG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The id must match the first value emitted by seqIds()
    expect(result.value.props.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  // ── id-provided branch: client-authored id ────────────────────────────────

  it("uses the caller-supplied id when one is provided", async () => {
    const clientId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const cmd: CreateTaskCommand = {
      id: clientId,
      text: "Follow up",
      leadId: null,
      dueDate: null,
    };
    const result = await useCase.exec(cmd, ORG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The supplied id must be preserved verbatim; the id generator must NOT be called.
    expect(result.value.props.id).toBe(clientId);
  });

  it("does not call the id generator when a client id is supplied", async () => {
    let generatorCalled = false;
    const trackingIds: IdGenerator = {
      newId: () => {
        generatorCalled = true;
        return "should-not-be-used";
      },
    };
    const uc = new CreateTaskUseCase(repo, clock, trackingIds);
    const cmd: CreateTaskCommand = {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      text: "Check the meter",
      leadId: null,
      dueDate: null,
    };
    await uc.exec(cmd, ORG);
    expect(generatorCalled).toBe(false);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("persists the task with the correct orgId", async () => {
    await useCase.exec({ text: "Call customer", leadId: null, dueDate: null }, ORG);
    expect(repo.created).toHaveLength(1);
    expect(repo.created[0]!.props.orgId).toBe(ORG);
  });

  it("trims leading and trailing whitespace from the text", async () => {
    const result = await useCase.exec(
      { text: "  Do the thing  ", leadId: null, dueDate: null },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.text).toBe("Do the thing");
  });

  it("threads the leadId through to the persisted task", async () => {
    const result = await useCase.exec(
      { text: "Site walk", leadId: LEAD, dueDate: null },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.leadId).toBe(LEAD);
  });

  it("accepts a null leadId and persists null", async () => {
    const result = await useCase.exec(
      { text: "General task", leadId: null, dueDate: null },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.leadId).toBeNull();
  });

  it("threads the dueDate through to the persisted task", async () => {
    const result = await useCase.exec(
      { text: "File permit", leadId: null, dueDate: "2026-08-01" },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.dueDate).toBe("2026-08-01");
  });

  it("accepts a null dueDate and persists null", async () => {
    const result = await useCase.exec(
      { text: "No deadline task", leadId: null, dueDate: null },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.dueDate).toBeNull();
  });

  it("returns the created task as ok value", async () => {
    const result = await useCase.exec(
      { text: "Return result test", leadId: null, dueDate: "2026-09-15" },
      ORG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.props.text).toBe("Return result test");
    expect(result.value.props.done).toBe(false);
  });
});
