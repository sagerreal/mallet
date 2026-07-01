// Public surface for the jobs module — the only sanctioned import seam (architecture rule).
export { createJobRouter } from "./api/job-router";
export type { Job, JobStatus, JobProps } from "./domain/job";
export type { JobRepository, JobFilter } from "./domain/job-repository";
export type { EstimateReader, EstimateSummary } from "./domain/estimate-reader";
// Exposed so other modules (e.g. invoicing) can read jobs through this seam without touching
// jobs internals.
export { DrizzleJobRepository } from "./infra/drizzle-job-repository";
export { ScheduleJobUseCase } from "./app/schedule-job";
export { CreateJobFromEstimateUseCase } from "./app/create-job-from-estimate";
export { RescheduleJobUseCase } from "./app/reschedule-job";
export { AssignJobUseCase } from "./app/assign-job";
export { StartJobUseCase } from "./app/start-job";
export { CompleteJobUseCase } from "./app/complete-job";
export { CancelJobUseCase } from "./app/cancel-job";
export { ListJobsUseCase } from "./app/list-jobs";
