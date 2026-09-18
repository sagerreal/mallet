import {
  conflict, err, ok, unauthorized, validation,
  type AppError, type Clock, type Result, type UserId,
} from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Role } from "@mallet/identity";
import type { AgentTask } from "../domain/agent-task";
import type { AgentTaskRepository } from "../domain/agent-task-repository";
import { MAX_OPEN_TASKS_PER_ORG, TITLE_MAX } from "./agent-task-config";

/**
 * modules/agent-tasks/app/create-agent-task.ts
 * File a piece of work for the AI employee.
 *
 * The instruction becomes the conversation's first message rather than a column: the loop reads a
 * transcript, and a task is just a conversation that has not started yet.
 *
 * Due immediately — the shop asked for it now, so the next tick should pick it up. "Do this on
 * Thursday" is the agent's own first decision (schedule_next_step), not a field on this form:
 * parsing dates out of prose here would be a second, worse date parser.
 */
export interface CreateAgentTaskCommand {
  readonly title: string;
  readonly instruction: string;
  readonly createdBy: UserId;
  readonly createdByRole: Role;
}

export class CreateAgentTaskUseCase {
  constructor(
    private readonly repo: AgentTaskRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateAgentTaskCommand): Promise<Result<AgentTask, AppError>> {
    // The employee's task list is an office surface — a tech filing background work for it to
    // do is not a capability this role has anywhere else in the product.
    if (cmd.createdByRole === "tech") {
      return err(unauthorized("the assistant's task list is an office surface"));
    }
    const instruction = cmd.instruction.trim();
    if (instruction.length === 0) {
      return err(validation("say what you want done", "instruction"));
    }
    if (instruction.length > 4000) {
      return err(validation("that instruction is too long — split it into separate tasks", "instruction"));
    }
    const title = cmd.title.trim();
    if (title.length === 0) return err(validation("a task needs a title", "title"));
    if (title.length > TITLE_MAX) {
      return err(validation(`a task title is at most ${TITLE_MAX} characters`, "title"));
    }

    const open = await this.repo.countOpen();
    if (open >= MAX_OPEN_TASKS_PER_ORG) {
      return err(
        conflict(
          `there are already ${MAX_OPEN_TASKS_PER_ORG} tasks open — close some before adding more`,
          "open",
        ),
      );
    }

    const now = this.clock.now();
    const task = await this.repo.create({
      id: this.ids.newId(),
      title,
      createdBy: cmd.createdBy,
      createdByRole: cmd.createdByRole,
      nextActionAt: now,
    });
    await this.repo.appendMessage(task.props.id, { role: "user", kind: "text", text: instruction });
    return ok(task);
  }
}
