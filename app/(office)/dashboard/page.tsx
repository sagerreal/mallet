"use client";

/**
 * Home — "The Handoff": the figure that drains.
 * One dollar figure (the money waiting on the owner's OK) is the subject of the
 * Front Desk's note. Below it: THE PIPE — the shop's money flowing through the
 * process (New → Quoted → Needs a slot → On the trucks → To bill → Owed →
 * Collected), each figure a door into its page, leaks glowing amber at the exact
 * stage. Then the drafts: real outbound SMS bubbles in ghost ink, one amber Send
 * from real; sending drains the hero (Undo refills it).
 *
 * Derivations: features/home/derive.ts + pipe.ts. Drafts: features/home/drafts.ts.
 */

import { todayISO } from "@/lib/clock";
import { useAppStore } from "@/lib/store/app-store";
import { deriveShiftReport, deriveOkQueue } from "@/features/home/derive";
import { deriveHomePipe } from "@/features/home/pipe";
import { HandoffNote } from "@/features/home/handoff-note";
import { HomePipe } from "@/features/home/home-pipe";
import { OkQueue } from "@/features/home/ok-queue";
import { useMe } from "@/features/identity/hooks";

/** "WED, JUL 8" from the live clock. */
function dateLabel(): string {
  return new Date(todayISO() + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export default function DashboardPage() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const frontDeskOn = useAppStore((s) => s.toggles.frontDesk);
  const dismissed = useAppStore((s) => s.dismissedAttention);

  // ---- real identity — org name + owner's first name from the DB -----------
  const me = useMe();
  const orgName = me.data?.orgName ?? "My Business";
  const ownerFirst =
    (me.data?.name?.split(" ")[0]) ??
    (me.data?.email?.split("@")[0]) ??
    "there";

  const report = deriveShiftReport(leads, jobs, estimates);
  const queue = deriveOkQueue(leads, estimates, invoices, dismissed);
  const queueValue = queue.reduce((s, it) => s + it.value, 0);
  const pipe = deriveHomePipe({ leads, estimates, invoices, jobs, techs });

  return (
    <div>
      <HandoffNote
        orgName={orgName}
        ownerFirst={ownerFirst}
        dateLabel={dateLabel()}
        frontDeskOn={frontDeskOn}
        report={report}
        queueCount={queue.length}
        queueValue={queueValue}
      />

      <HomePipe stages={pipe} />

      <OkQueue items={queue} ctx={{ orgName, ownerFirst }} />
    </div>
  );
}
