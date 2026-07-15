// Setup checklist derivation — PURE. Answers "is this shop's AI Front Desk actually set up?"
// from real state, so the Home card can show what's left and vanish when everything's done.
// No manual check-offs: every step is derived, so it can never lie or go stale.

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** Where the row takes you to finish the step. */
  href: string;
}

export interface SetupInputs {
  /** booking.services.length */
  servicesCount: number;
  /** booking.area.originAddress (trimmed check happens here) */
  originAddress: string;
  /** any team member flagged is_field_crew */
  hasFieldCrew: boolean;
  /** any lead whose source is the AI Front Desk (proves a call has landed end-to-end) */
  hasAiLead: boolean;
}

export function deriveSetupSteps(i: SetupInputs): SetupStep[] {
  return [
    {
      key: "services",
      label: "Add your services",
      done: i.servicesCount > 0,
      href: "/settings?tab=booking",
    },
    {
      key: "area",
      label: "Set your office address & radius",
      done: i.originAddress.trim().length > 0,
      href: "/settings?tab=booking",
    },
    {
      key: "crew",
      label: "Mark your field crew",
      done: i.hasFieldCrew,
      href: "/settings?tab=workspace",
    },
    {
      key: "first-call",
      label: "Receive your first AI-answered call",
      done: i.hasAiLead,
      href: "/settings?tab=booking",
    },
  ];
}

export function setupComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((s) => s.done);
}
