import type { LeadId, Result, AppError } from "@mallet/shared/types";
import { validation, err, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../domain/task-repository";

export interface CreateTaskCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly leadId: LeadId | null;
  readonly text: string;
  readonly dueDate: string | null;
}

export class CreateTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(
    cmd: CreateTaskCommand,
    orgId: string,
  ): Promise<Result<Task, AppError>> {
    const text = cmd.text.trim();
    if (text.length === 0) return err(validation("task text is required", "text"));

    const task = await this.tasks.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      leadId: cmd.leadId,
      text,
      dueDate: cmd.dueDate,
    });

    logger.info(
      { taskId: task.props.id, orgId, leadId: cmd.leadId },
      "task.created",
    );

    return ok(task);
  }
}
