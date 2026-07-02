/**
 * features/pipeline/use-lead-drag.ts
 * HTML5 drag-and-drop hook for the pipeline kanban.
 * No new npm deps — uses native draggable + DataTransfer APIs.
 */

"use client";

import { useCallback, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";

export interface DragHandlers {
  dragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLElement>, leadId: number) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>, stage: string) => void;
}

export function useLeadDrag(): DragHandlers {
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const leads = useAppStore((s) => s.leads);

  // Use a ref so handlers are stable across renders
  const dragIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const onDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, leadId: number) => {
      dragIdRef.current = leadId;
      draggingRef.current = true;
      try {
        e.dataTransfer.setData("text/plain", String(leadId));
      } catch {
        // ignore — setData can throw in some environments
      }
      document.body.classList.add("dragging");
    },
    []
  );

  const onDragEnd = useCallback(() => {
    draggingRef.current = false;
    document.body.classList.remove("dragging");
    document.querySelectorAll<HTMLElement>(".col.dragover").forEach((el) => {
      el.classList.remove("dragover");
    });
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add("dragover");
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.currentTarget.classList.remove("dragover");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>, stage: string) => {
      e.preventDefault();
      e.currentTarget.classList.remove("dragover");

      const id = dragIdRef.current;
      if (id === null) return;

      const lead = leads.find((l) => l.id === id);
      if (!lead || lead.stage === stage) {
        onDragEnd();
        return;
      }

      moveLeadStage(id, stage);
      onDragEnd();
    },
    [leads, moveLeadStage, onDragEnd]
  );

  return {
    dragging: draggingRef.current,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
