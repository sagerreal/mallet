import type { TaskId, LeadId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../domain/task-repository";

export interface UpdateTaskCommand {
  readonly taskId: TaskId;
  readonly text?: string;
  readonly dueDate?: string | null;
  readonly leadId?: LeadId | null;
}

export class UpdateTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: UpdateTaskCommand,
    orgId: string,
  ): Promise<Result<Task, AppError>> {
    const task = await this.tasks.findById(cmd.taskId);
    if (!task) return err(notFound("task not found"));

    const now = this.clock.now();
    const patched = task.patch(
      {
        text: cmd.text,
        dueDate: cmd.dueDate,
        leadId: cmd.leadId,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.tasks.save(patched.value);

    logger.info(
      { taskId: cmd.taskId, orgId },
      "task.updated",
    );

    return ok(patched.value);
  }
}
