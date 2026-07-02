"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Input, Select } from "@/components/ui/input";
import { userMessage } from "@/lib/trpc/error-map";
import { useMembers } from "@/features/identity/hooks";
import {
  useAssignJob,
  useRescheduleJob,
  useStartJob,
  useCompleteJob,
  useCancelJob,
} from "./hooks";

type JobLike = { id: string; status: string; assigneeUserId: string | null };

export function JobActions({ job }: { job: JobLike }) {
  const members = useMembers();
  const assign = useAssignJob();
  const reschedule = useRescheduleJob();
  const start = useStartJob();
  const complete = useCompleteJob();
  const cancel = useCancelJob();
  const [panel, setPanel] = useState<"none" | "reschedule" | "cancel">("none");
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));
  const active = job.status === "scheduled" || job.status === "in_progress";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {job.status === "scheduled" ? (
          <Button disabled={start.isPending} onClick={() => start.mutate({ jobId: job.id }, { onError })}>
            Start
          </Button>
        ) : null}
        {job.status === "in_progress" ? (
          <Button disabled={complete.isPending} onClick={() => complete.mutate({ jobId: job.id }, { onError })}>
            Complete
          </Button>
        ) : null}
        {active ? (
          <Button variant="quiet" onClick={() => setPanel("reschedule")}>
            Reschedule
          </Button>
        ) : null}
        {active ? (
          <Button variant="danger" onClick={() => setPanel("cancel")}>
            Cancel job
          </Button>
        ) : null}
      </div>
      {active ? (
        <Field label="Assigned to">
          <Select
            value={job.assigneeUserId ?? ""}
            disabled={assign.isPending}
            onChange={(e) =>
              assign.mutate(
                { jobId: job.id, assigneeUserId: e.target.value || null },
                { onError },
              )
            }
          >
            <option value="">Unassigned</option>
            {(members.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.email} ({m.role})
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <Sheet open={panel === "reschedule"} title="Reschedule" onClose={() => setPanel("none")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            reschedule.mutate(
              {
                jobId: job.id,
                scheduledStart: new Date(String(f.get("start"))).toISOString(),
                scheduledEnd: new Date(String(f.get("end"))).toISOString(),
              },
              { onSuccess: () => setPanel("none"), onError },
            );
          }}
        >
          <Field label="Starts">
            <Input name="start" type="datetime-local" required />
          </Field>
          <Field label="Ends">
            <Input name="end" type="datetime-local" required />
          </Field>
          <Button type="submit" disabled={reschedule.isPending}>
            Save schedule
          </Button>
        </form>
      </Sheet>
      <Sheet open={panel === "cancel"} title="Cancel job" onClose={() => setPanel("none")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate(
              { jobId: job.id, reason: String(new FormData(e.currentTarget).get("reason")) },
              { onSuccess: () => setPanel("none"), onError },
            );
          }}
        >
          <Field label="Reason">
            <Input name="reason" required />
          </Field>
          <Button variant="danger" type="submit" disabled={cancel.isPending}>
            Confirm cancel
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
