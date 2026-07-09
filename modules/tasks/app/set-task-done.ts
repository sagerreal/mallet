import type { TaskId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../domain/task-repository";

export interface SetTaskDoneCommand {
  readonly taskId: TaskId;
  readonly done: boolean;
}

export class SetTaskDoneUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: SetTaskDoneCommand,
    orgId: string,
  ): Promise<Result<Task, AppError>> {
    const task = await this.tasks.findById(cmd.taskId);
    if (!task) return err(notFound("task not found"));

    const updated = task.setDone(cmd.done, this.clock.now());
    if (updated !== task) {
      await this.tasks.save(updated);
    }

    logger.info(
      { taskId: cmd.taskId, orgId, done: cmd.done },
      "task.done_set",
    );

    return ok(updated);
  }
}
