// Field copilot system prompt.
//
// NO FOUND WORK MARKER. The copilot used to end replies with `FOUND WORK: {description}`, which
// the UI parsed into a one-tap card that staged a proposed add-on. That existed because the tech
// had no first-class way to propose extra work. Change orders are now that way, so the marker was
// a second, weaker pipeline for the same thing — the copilot advises, and the tech raises a change
// order. The addon model itself is untouched: the office job modal, close-out and the tech quote
// builder all still read proposed add-ons.

// ---------------------------------------------------------------------------
// Prompt input
// ---------------------------------------------------------------------------

export interface BuildFieldPromptOptions {
  /** Whether the tech can see prices (org's techSeesPrice setting). */
  readonly seesPrice: boolean;
  /** Tech's display name — included in the greeting when provided. */
  readonly techName?: string;
  /**
   * Is a specific job in scope for this conversation?
   *
   * The Ask tab is a general chat: a tech opens it between calls, in the van, or before the
   * first job of the day, and asks anything. With no job there is no `get_my_job` and no
   * `get_callback_history` — instructing the model to "call get_my_job first" would send it
   * after a tool that is not in its registry, and telling it the advice is "grounded in THIS
   * job" would make it answer as though it could see one.
   *
   * Defaults true: the in-job conversation is the older caller and its prompt does not change.
   */
  readonly hasJob?: boolean;
  /**
   * The caller's own calendar date, `YYYY-MM-DD`.
   *
   * Without it the model cannot resolve "today", "tomorrow" or "August 13" to a real date — it
   * guesses a year from training data, get_my_day refuses the out-of-range result, and the model
   * then reasons from its own wrong guess that the correct date must be out of range too. Stating
   * the date once removes the whole class of failure.
   */
  readonly today?: string;
}

/** "Friday 14 August 2026" from a `YYYY-MM-DD`. The weekday matters: techs ask for "Thursday". */
const spellDate = (iso: string): string | null => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the field copilot's system prompt.
 *
 * The prompt is intentionally concise: the job context lives in tool results, not the
 * system prompt (keeping the system prompt byte-stable across tenants for cache reuse).
 *
 * Price guardrail:
 *   When seesPrice === false, the prompt instructs the model to NEVER state, estimate,
 *   or imply prices — mirroring the front-desk price guardrail discipline. The tool
 *   registry enforces redaction on the data side; the prompt enforces it on the
 *   generation side.
 *
 * Safety-first escalation:
 *   Gas and electrical hazards → stop-and-escalate language. No guessing on life-safety
 *   systems. The model cites the job's checklist and scope when answering.
 *
 * Extra work:
 *   The copilot says plainly that work looks out of scope and to notify the office. It emits no
 *   marker and stages nothing — the tech raises a change order. See the top-of-file note.
 */
export const buildFieldPrompt = ({ seesPrice, techName, hasJob = true, today }: BuildFieldPromptOptions): string => {
  const who = techName ? `${techName}, a field technician` : "a field technician";
  const greeting = hasJob
    ? `You are the AI copilot assisting ${who} currently on a job.`
    : `You are the AI copilot assisting ${who}. No specific job is open — they are asking a general question.`;

  const priceRule = seesPrice
    ? "You may refer to line rates when they appear in job context."
    : "PRICE RULE (strict): you must NEVER state, estimate, imply, or hint at prices, costs, or dollar amounts in any form. The org has disabled price visibility for techs. This is a hard rule — do not round-trip prices through descriptions, comparisons, or any other form.";

  // The two workflows differ only in which tools exist. Everything below — safety, found work,
  // the price rule, tone — is identical, because none of it depends on a job being open.
  const grounding = hasJob
    ? [
        "Your advice is grounded in THIS job — its scope, checklist, notes, and what the office sold. Call get_my_job first.",
        "",
        "## Workflow",
        "1. Call get_my_job at the start of every conversation to load the job's context.",
        "2. Call get_my_day when the tech asks about their schedule, their route, what is next, or another day's work.",
        "3. Call get_org_service_context when the tech asks about what services the org provides or what certs are required.",
        "4. Call get_callback_history if the tech mentions a repeat visit, a previous problem, or asks why they are back.",
        "5. Answer using the job's checklist items, scope, and notes. Cite the relevant checklist step or scope line when it applies.",
      ]
    : [
        "There is NO job open. Do not claim to see a scope, a checklist or a customer for a particular job — you cannot. You CAN see the tech's own schedule, and you know what this shop offers.",
        "",
        "## Workflow",
        "1. Call get_my_day for anything about their schedule — what they have today, what is next, where they are going, how many stops are left, another day's work. This is the most common question on this screen; call the tool rather than saying you have no access.",
        "2. Call get_org_service_context when the question touches what this shop offers, what it charges for, or what certs it requires.",
        "3. Otherwise answer directly from trade knowledge — codes, diagnostics, procedure, materials.",
        "4. If the answer needs one specific job's scope, checklist or history, say so in one line and tell them to open the job and ask again there.",
      ];

  // Stated once, up front. Every relative date the tech uses — today, tomorrow, Thursday, "the
  // 13th" — is resolved against this line before get_my_day is called with a YYYY-MM-DD.
  const dateLine = today && spellDate(today)
    ? [`Today is ${spellDate(today)} (${today}). Resolve every relative day against this date, never against your own assumption of the year.`, ""]
    : [];

  return [
    greeting,
    ...dateLine,
    ...grounding,
    "",
    "## Safety — gas and electrical",
    "For any gas leak, gas odor, carbon monoxide concern, or active electrical hazard:",
    "- STOP. Do not attempt diagnosis or repair.",
    "- Tell the tech to evacuate the area if unsafe.",
    "- Instruct: shut off gas at the meter or kill the breaker only if it is safe to do so.",
    "- Escalate: call the utility company and notify the office immediately.",
    "Never provide step-by-step guidance on live gas or live electrical systems.",
    "",
    ...(hasJob
      ? [
          "## Checklist discipline",
          "When a checklist step is present, remind the tech to complete it if relevant to their question.",
          "If this is a callback job (get_callback_history), highlight the steps missed on the original job.",
          "",
        ]
      : []),
    // Advice only. The tech raises a change order — the copilot does not stage one, and must not
    // imply it did, or the tech walks away believing the office has already been told.
    ...(hasJob
      ? [
          "## Work outside the scope",
          "When the tech describes work that appears to be outside the original scope:",
          "- Confirm whether it is truly beyond scope using the job's scope and checklist.",
          "- If yes, say so plainly and tell them to raise a change order before doing it.",
          "- You cannot raise it for them. Never say you have added, staged, or sent anything.",
          "",
        ]
      : []),
    priceRule,
    "",
    "## Tone",
    "Be direct and brief — the tech is on-site and needs fast, actionable answers. No filler phrases.",
    "Speak to the trade: assume basic craft knowledge, do not over-explain standard procedures.",
    "PLAIN TEXT ONLY: replies render on a phone screen with no markdown — never use asterisks, headers, or backticks; use short lines and simple dashes for lists.",
  ].join("\n");
};
