/**
 * lib/store/checklists-mapper.ts
 * Single DTO→store conversion site for checklists.
 * Used by the hydrator query transform AND the slice mutation reconcile
 * — one shape, one mapper.
 */

import type { Checklist } from "./types";

// The subset of the checklist DTO both the list-hydrator and the mutation-reconcile receive.
// createdAt is present on the server DTO but unused by the store shape — listed here so
// callers that pass the full DTO don't hit a structural mismatch.
interface ChecklistDtoShape {
  id: string;
  name: string;
  trade: string;
  stage: "job" | "scope";
  match: readonly string[];
  items: readonly {
    id: string;
    text: string;
    type: "check" | "photo";
    required: boolean;
    position: number;
  }[];
  createdAt?: string;
}

export function checklistDtoToStore(dto: ChecklistDtoShape): Checklist {
  return {
    id: dto.id,
    name: dto.name,
    trade: dto.trade,
    stage: dto.stage,
    match: [...dto.match],
    items: dto.items.map((i) => ({
      id: i.id,
      text: i.text,
      type: i.type,
      required: i.required,
      position: i.position,
    })),
  };
}
