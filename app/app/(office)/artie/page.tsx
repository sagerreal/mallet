"use client";

/**
 * app/(office)/artie/page.tsx
 * Artie's board: the four-column list, the in-flow composer, and the task drawer. Thin shell —
 * all read/write logic lives in features/artie/*; this owns only which panel is open.
 *
 * Registered in the shell navigation by Task 14 (components/shell/sidebar.tsx, more-links.tsx,
 * topbar.tsx) — this file only owns the page itself.
 */

import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ArtieBoard } from "@/features/artie/artie-board";
import { NewTaskForm } from "@/features/artie/new-task-form";
import { TaskDrawer } from "@/features/artie/task-drawer";
import { ARTIE_COPY } from "@/features/artie/artie-copy";

export default function ArtiePage() {
  const [composing, setComposing] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const openComposer = (): void => {
    setComposing(true);
    setOpenTaskId(null);
  };

  return (
    <div>
      <PageHeader
        title={ARTIE_COPY.pageTitle}
        action={
          <Button size="sm" onClick={openComposer} disabled={composing}>
            {ARTIE_COPY.newTask}
          </Button>
        }
      />
      {/* Mobile-only: PageHeader's action is hidden on mobile by contract (docs/design-system.md). */}
      <div className="mob-new">
        <Button onClick={openComposer} disabled={composing}>
          {ARTIE_COPY.newTask}
        </Button>
      </div>

      {composing ? (
        <NewTaskForm
          onCreated={(taskId) => {
            setComposing(false);
            setOpenTaskId(taskId);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      <ArtieBoard onOpen={setOpenTaskId} onNewTask={openComposer} />

      {openTaskId ? <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}
