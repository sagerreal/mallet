/**
 * features/checklists/checklist-seed.ts
 * Seed DATA for the "Start with plumbing basics" one-click row shown when a shop
 * has no saved checklists yet (job-checklist-block empty state). Pure data, no
 * logic — created through the normal addChecklist path (v1.checklists.create),
 * following the opt-in pricebook-seed precedent (settings/pricebook-seed.ts).
 *
 * Item TYPE is derived at creation time by the shared "Photo…" heuristic, and
 * quick-created items are required — same rules as a pasted checklist.
 */

export interface SeedChecklist {
  readonly name: string;
  readonly items: readonly string[];
}

export const PLUMBING_STARTER_CHECKLISTS: readonly SeedChecklist[] = [
  {
    name: "Water heater close-out",
    items: [
      "Photo of the finished install",
      "T&P valve tested",
      "Gas and water connections leak-checked",
      "Thermostat set, customer shown",
      "Old unit hauled away",
    ],
  },
  {
    name: "Drain call close-out",
    items: [
      "Flow tested after clearing",
      "Photo of the cleared line",
      "Work area wiped down",
      "Customer shown the result",
    ],
  },
  {
    name: "Leave-the-site basics",
    items: [
      "Water back on, fixtures tested",
      "Photo of the work area on exit",
      "Tools and parts packed",
      "Next steps confirmed with customer",
    ],
  },
];
