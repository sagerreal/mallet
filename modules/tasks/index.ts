// Public surface for the tasks module — the only sanctioned import seam.
export { createTaskRouter } from "./api/task-router";
export type { Task, TaskProps } from "./domain/task";
export type { TaskRepository, TaskFilter } from "./domain/task-repository";
export { CreateTaskUseCase } from "./app/create-task";
export { ListTasksUseCase } from "./app/list-tasks";
export { SetTaskDoneUseCase } from "./app/set-task-done";
export { UpdateTaskUseCase } from "./app/update-task";
export { RemoveTaskUseCase } from "./app/remove-task";
export { DrizzleTaskRepository } from "./infra/drizzle-task-repository";
