/**
 * components/modals/tech-job-modal/tech-job-foot.test.ts
 *
 * The foot's contract. Two things it must never get wrong:
 *   - FINISH IS ALWAYS ONE TAP — from every open state, either the primary finishes the job or a
 *     quiet Finish sits under it. A man in a customer's kitchen must never have to tap "on the
 *     way" before he can close the job he has just finished.
 *   - THERE IS ALWAYS A PRIMARY — the sheet must never be dismissable only via the shell's ✕.
 *
 * Each case also RUNS the button, because a foot whose label is right and whose handler is wrong
 * is the worse of the two failures.
 */
import { describe, it, expect, vi } from "vitest";
import { footActions, type FootFacts, type FootHandlers } from "./tech-job-foot";
import type { Invoice, Job, Lead, Visit } from "@/lib/store/types";

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-08-04",
  techId: "tech-1",
  start: 15,
  dur: 2,
  status: "scheduled",
  ...over,
});

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    num: "JOB-2541",
    status: "scheduled",
    visits: [],
    lines: [],
    addons: [],
    invRequested: false,
    total: 0,
    ...over,
  }) as Job;

const handlers = (): FootHandlers & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    setVisitStatus: vi.fn((visitId: string, status: string) => calls.push(`status:${visitId}:${status}`)),
    chargeOnFile: vi.fn(() => calls.push("charge")),
    openCloseOut: vi.fn(() => calls.push("closeout")),
    sendToOffice: vi.fn(() => calls.push("sendoffice")),
    dismiss: vi.fn(() => calls.push("dismiss")),
  };
};

const facts = (over: Partial<FootFacts> = {}): FootFacts => ({
  job: job(),
  lead: undefined,
  invoice: undefined,
  isOffice: false,
  canTakePayment: false,
  scoping: false,
  done: false,
  actVisit: undefined,
  ...over,
});

describe("footActions — an open job advances", () => {
  it("scheduled: the primary starts the drive, and Finish waits underneath", () => {
    const on = handlers();
    const foot = footActions(facts({ actVisit: visit({ status: "scheduled" }) }), on);

    expect(foot.primary.label).toBe("Start driving →");
    expect(foot.quiet?.label).toBe("Finish job →");

    foot.primary.run();
    foot.quiet?.run();
    expect(on.calls).toEqual(["status:v1:enroute", "status:v1:done"]);
  });

  it("en route: the primary is the arrival, and Finish still waits underneath", () => {
    const on = handlers();
    const foot = footActions(facts({ actVisit: visit({ status: "enroute" }) }), on);

    expect(foot.primary.label).toBe("I've arrived →");
    expect(foot.quiet?.label).toBe("Finish job →");

    foot.primary.run();
    expect(on.calls).toEqual(["status:v1:onsite"]);
  });

  it("on site: the primary IS Finish, so nothing is repeated beneath it", () => {
    const on = handlers();
    const foot = footActions(facts({ actVisit: visit({ status: "onsite" }) }), on);

    expect(foot.primary.label).toBe("Finish job →");
    expect(foot.quiet).toBeNull();

    foot.primary.run();
    expect(on.calls).toEqual(["status:v1:done"]);
  });

  // A tech looking at a colleague's visit. The server refuses both writes, so a live-looking
  // button would just error — but the sheet must still be closable.
  it("no visit this viewer may move: the plain Done, which dismisses", () => {
    const on = handlers();
    const foot = footActions(facts({ actVisit: undefined }), on);

    expect(foot.primary.label).toBe("Done");
    expect(foot.quiet).toBeNull();
    foot.primary.run();
    expect(on.calls).toEqual(["dismiss"]);
  });
});

describe("footActions — a done job settles", () => {
  const card = { brand: "Visa", last4: "4242", via: "stripe" };
  const owing = { id: "inv-1", total: 240, paidTotal: 0 } as Invoice;

  const doneFacts = (over: Partial<FootFacts> = {}): FootFacts =>
    facts({ done: true, canTakePayment: true, job: job({ status: "done" }), ...over });

  it("a card on file: the primary charges it and names the amount", () => {
    const on = handlers();
    const foot = footActions(doneFacts({ invoice: owing, lead: { id: "l1", card } as Lead }), on);

    expect(foot.primary.label).toContain("Charge $240");
    expect(foot.primary.label).toContain("Visa");
    expect(foot.quiet).toBeNull();

    foot.primary.run();
    expect(on.calls).toEqual(["charge"]);
  });

  it("no card: the primary opens the close-out to take payment", () => {
    const on = handlers();
    const foot = footActions(doneFacts({ invoice: owing }), on);

    expect(foot.primary.label).toBe("Take payment →");
    foot.primary.run();
    expect(on.calls).toEqual(["closeout"]);
  });

  it("nothing priced, and the office may hand it off: the primary does that", () => {
    const on = handlers();
    const foot = footActions(doneFacts({ isOffice: true }), on);

    expect(foot.primary.label).toBe("Send to the office to bill");
    foot.primary.run();
    expect(on.calls).toEqual(["sendoffice"]);
  });

  // THE RULE AN UNPRICED ESTIMATE TURNS ON. A scoping visit has no bill, so no billing branch may
  // render — its close-out is the scope handoff, in the body.
  it("a done, unpriced ESTIMATE gets no billing foot at all", () => {
    const on = handlers();
    const foot = footActions(doneFacts({ scoping: true, invoice: owing, isOffice: true }), on);

    expect(foot.primary.label).toBe("Done");
    foot.primary.run();
    expect(on.calls).toEqual(["dismiss"]);
  });

  it("a viewer who may not collect gets no money button", () => {
    const on = handlers();
    const foot = footActions(doneFacts({ canTakePayment: false, invoice: owing }), on);

    expect(foot.primary.label).toBe("Done");
  });

  it("a settled bill has no terminal action left, and keeps the plain Done", () => {
    const on = handlers();
    const settled = { id: "inv-1", total: 240, paidTotal: 240 } as Invoice;
    const foot = footActions(doneFacts({ invoice: settled, isOffice: true }), on);

    expect(foot.primary.label).toBe("Done");
  });
});

// The invariant, stated once over every state this sheet can be in.
describe("footActions — the invariants", () => {
  const states: Visit["status"][] = ["scheduled", "enroute", "onsite", "done"];

  it("always offers a primary", () => {
    for (const status of states) {
      const foot = footActions(facts({ actVisit: visit({ status }) }), handlers());
      expect(foot.primary.label).toBeTruthy();
    }
    expect(footActions(facts(), handlers()).primary.label).toBeTruthy();
  });

  it("on an open job with a movable visit, Finish is always exactly one tap away", () => {
    for (const status of states) {
      const on = handlers();
      const foot = footActions(facts({ actVisit: visit({ id: "v9", status }) }), on);
      const finish = foot.primary.label.startsWith("Finish") ? foot.primary : foot.quiet;
      expect(finish?.label).toBe("Finish job →");
      finish?.run();
      expect(on.calls).toEqual(["status:v9:done"]);
    }
  });
});

/**
 * The label has to name what the tap actually finishes.
 *
 * The WRITE was already right: SetVisitStatusUseCase derives job status from the visit set, so
 * finishing visit 1 of 2 leaves the job open. Only the sentence was wrong — it said "Finish job"
 * while finishing a visit, which is the one screen a technician reads before telling a customer
 * whether they are coming back.
 */
describe("footActions — a job with more than one visit", () => {
  const twoVisits = (over: Partial<Visit> = {}) =>
    job({ visits: [visit({ id: "v1", ...over }), visit({ id: "v2", status: "scheduled" })] });

  it("names the VISIT while another active visit remains", () => {
    const on = handlers();
    const foot = footActions(
      facts({ job: twoVisits({ status: "onsite" }), actVisit: visit({ id: "v1", status: "onsite" }) }),
      on,
    );

    expect(foot.primary.label).toBe("Finish visit →");
    foot.primary.run();
    // Same write as before — only the sentence changed.
    expect(on.calls).toEqual(["status:v1:done"]);
  });

  it("names the visit on the quiet button too, from an earlier step", () => {
    const foot = footActions(
      facts({ job: twoVisits({ status: "scheduled" }), actVisit: visit({ id: "v1", status: "scheduled" }) }),
      handlers(),
    );

    expect(foot.primary.label).toBe("Start driving →");
    expect(foot.quiet?.label).toBe("Finish visit →");
  });

  it("names the JOB again once every other visit is done — this tap really does close it", () => {
    const foot = footActions(
      facts({
        job: job({ visits: [visit({ id: "v1", status: "onsite" }), visit({ id: "v2", status: "done" })] }),
        actVisit: visit({ id: "v1", status: "onsite" }),
      }),
      handlers(),
    );

    expect(foot.primary.label).toBe("Finish job →");
  });

  it("names the job on a single-visit job — the common case is untouched", () => {
    const foot = footActions(
      facts({
        job: job({ visits: [visit({ id: "v1", status: "onsite" })] }),
        actVisit: visit({ id: "v1", status: "onsite" }),
      }),
      handlers(),
    );

    expect(foot.primary.label).toBe("Finish job →");
  });

  it("an UNPLACED follow-up visit counts — that is the whole point of booking one", () => {
    const foot = footActions(
      facts({
        job: job({
          visits: [
            visit({ id: "v1", status: "onsite" }),
            // What field.addFollowUpVisit writes: no date, no tech, waiting on the office.
            visit({ id: "v2", status: "scheduled", date: undefined, start: undefined, techId: undefined }),
          ],
        }),
        actVisit: visit({ id: "v1", status: "onsite" }),
      }),
      handlers(),
    );

    expect(foot.primary.label).toBe("Finish visit →");
  });
});
