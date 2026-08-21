/**
 * features/artie/artie-copy.ts
 * Every user-facing string on the Artie surface. Functional, not chatty: the copy states what is
 * true and what to do next, and it never pretends the agent is a person.
 */
export const ARTIE_COPY = {
  pageTitle: "Artie",
  newTask: "+ New task",
  columns: {
    needs_you: "Needs you",
    working: "Working",
    done: "Done",
    closed: "Closed",
  },
  emptyColumn: "Nothing here",
  firstRun: {
    heading: "Nothing on Artie's list yet",
    subtext:
      "Give Artie a job and it will work on it in the background, checking back with you when it needs a decision.",
    add: {
      title: "Give Artie something to do",
      description: "Chase a quote, follow up on an unpaid invoice, tidy up a customer record.",
      actionLabel: "+ New task",
    },
  },
  form: {
    titleLabel: "What is this about?",
    titlePlaceholder: "Follow up with the Hendersons",
    instructionLabel: "What should Artie do?",
    instructionPlaceholder:
      "Ask whether they want to go ahead with the water heater quote, and book them in if they do.",
    submit: "Give it to Artie",
    cancel: "Cancel",
  },
  drawer: {
    // Not "Close" — that word is already spoken for by drawer.close (closes the TASK). Distinct
    // wording so the two controls can never be mistaken for one another mid-scroll.
    back: "‹ Back to Artie's tasks",
    // A lone item reads as "Approve"/"Not this one"; two or more get the *All variants, since the
    // server only resolves a pending turn when every id in it is decided together (see
    // task-drawer.tsx's PendingList) — the label has to say "all" or the grouping is invisible.
    approve: "Approve",
    deny: "Not this one",
    approveAll: "Approve all",
    denyAll: "Not any of these",
    replyPlaceholder: "Reply to Artie…",
    send: "Send",
    sending: "Sending…",
    close: "Close this task",
    approvalLead: "Artie wants to:",
    turnLabels: { user: "You", assistant: "Artie" },
    finished: "This task is finished.",
  },
  /**
   * Fallback text only. The router's CONFLICT errors are written to be read by a person
   * ("Artie is working on this right now — give it a moment and reload.") and are shown
   * verbatim (see userMessage's PASS_THROUGH set) — this string is what a caller sees ONLY if a
   * CONFLICT ever arrives with no message, never in the normal path. Never invented copy in
   * place of the server's own sentence.
   */
  conflict: "Artie changed this task while you were looking. Reload to see it.",
  loadFailedNoun: "Artie's tasks",
  loadFailedTaskNoun: "this task",
} as const;
