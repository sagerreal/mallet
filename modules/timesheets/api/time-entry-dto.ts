import { z } from "zod";
import type { TimeEntry } from "../domain/time-entry";

export const timeEntryDTO = z.object({
  id: z.string().uuid(),
  techUserId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  workDate: z.string(),
  kind: z.enum(["job", "travel", "break", "shop"]),
  startTime: z.string(),
  endTime: z.string().nullable(),
  note: z.string(),
  src: z.enum(["manual", "clock", "timer"]),
  status: z.enum(["draft", "approved"]),
  running: z.boolean(),
  approvedAt: z.string().nullable(), // ISO string or null
  createdAt: z.string(),
});

export type TimeEntryDTO = z.infer<typeof timeEntryDTO>;

export const toTimeEntryDTO = (entry: TimeEntry): TimeEntryDTO => {
  const p = entry.props;
  return {
    id: p.id,
    techUserId: p.techUserId,
    jobId: p.jobId,
    workDate: p.workDate,
    kind: p.kind,
    startTime: p.startTime,
    endTime: p.endTime,
    note: p.note,
    src: p.src,
    status: p.status,
    running: p.running,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
};
