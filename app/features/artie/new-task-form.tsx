"use client";

/**
 * features/artie/new-task-form.tsx
 * Give Artie something to do. In-flow composer opened by the page's "+ New task" button — not a
 * modal, not a popover (house rule) — the same shape as messages-inbox.tsx's "+ New message" /
 * NewConversation toggle.
 */

import { useState, type FormEvent } from "react";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ARTIE_COPY } from "./artie-copy";

export interface NewTaskFormProps {
  readonly onCreated: (taskId: string) => void;
  readonly onCancel: () => void;
}

export function NewTaskForm({ onCreated, onCancel }: NewTaskFormProps) {
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const create = api.v1.agentTasks.create.useMutation({
    onSuccess: (task) => {
      void utils.v1.agentTasks.list.invalidate();
      setTitle("");
      setInstruction("");
      onCreated(task.id);
    },
    onError: (err) => setError(userMessage(err)),
  });

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanInstruction = instruction.trim();
    if (!cleanTitle || !cleanInstruction || create.isPending) return;
    setError(null);
    create.mutate({ title: cleanTitle, instruction: cleanInstruction });
  };

  return (
    <Card>
      <form onSubmit={submit} className="stack-3">
        <Field label={ARTIE_COPY.form.titleLabel}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={ARTIE_COPY.form.titlePlaceholder}
            maxLength={120}
            disabled={create.isPending}
            required
          />
        </Field>
        <Field label={ARTIE_COPY.form.instructionLabel}>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={ARTIE_COPY.form.instructionPlaceholder}
            rows={3}
            maxLength={4000}
            disabled={create.isPending}
            required
          />
        </Field>
        {error ? (
          <p role="alert" style={{ color: "var(--red)" }}>
            {error}
          </p>
        ) : null}
        <div className="cardacts">
          <Button type="submit" size="sm" disabled={create.isPending}>
            {ARTIE_COPY.form.submit}
          </Button>
          <Button type="button" variant="quiet" size="sm" onClick={onCancel} disabled={create.isPending}>
            {ARTIE_COPY.form.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
