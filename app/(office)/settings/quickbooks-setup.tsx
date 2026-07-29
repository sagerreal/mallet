"use client";

/**
 * Settings → QuickBooks → the setup that has to exist before any hours can move: which QuickBooks
 * service the time is filed under, who each person is in QuickBooks, and the opt-in switch.
 *
 * QuickBooks REJECTS a time entry without a service item and a person, so neither of these is
 * optional polish — they are the preconditions. Matching is an explicit picker rather than
 * name-matching on purpose: name-matching is the single biggest support burden in the comparable
 * integrations ("Mike" vs "Michael" silently breaks payroll).
 *
 * List-first (rows, not a wall of fields); in-flow; tokens only.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { SelectMenu } from "@/components/ui/select-menu";

const label = { fontSize: "var(--type-base)", color: "var(--ink-2)" } as const;
const note = { fontSize: "var(--type-sm)", color: "var(--ink-3)" } as const;

export function QuickbooksSetup() {
  const setup = api.v1.qbo.setup.useQuery();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    utils.v1.qbo.setup.invalidate();
    utils.v1.qbo.status.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);

  const linkPerson = api.v1.qbo.linkPerson.useMutation({ onSuccess: invalidate, onError });
  const setItem = api.v1.qbo.setDefaultItem.useMutation({ onSuccess: invalidate, onError });
  const setSend = api.v1.qbo.setSendApprovedHours.useMutation({ onSuccess: invalidate, onError });
  const setInvItem = api.v1.qbo.setDefaultInvoiceItem.useMutation({ onSuccess: invalidate, onError });
  const setSendInv = api.v1.qbo.setSendInvoices.useMutation({ onSuccess: invalidate, onError });

  if (setup.isLoading) {
    return <p style={{ ...label, color: "var(--ink-3)" }} aria-busy="true">Loading…</p>;
  }
  if (setup.error || !setup.data) {
    return (
      <p style={{ ...label, color: "var(--red)" }} role="alert">
        Couldn’t read your QuickBooks setup. {setup.error?.message ?? ""}
      </p>
    );
  }

  const s = setup.data;
  const matched = s.crew.filter((c) => c.qboId).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {/* Blockers first — neither is something the shop can fix from inside Mallet. */}
      {!s.timeTrackingEnabled && (
        <p style={{ ...label, color: "var(--red)" }} role="alert">
          Time tracking is switched off in QuickBooks. Turn it on there (Settings → Account and
          settings → Time), then reload this page.
        </p>
      )}

      {s.existingTimeEntries > 0 && (
        <p style={{ ...label, color: "var(--red)" }} role="alert">
          QuickBooks already has {s.existingTimeEntries} time{" "}
          {s.existingTimeEntries === 1 ? "entry" : "entries"} in the last 30 days. If your crew
          clocks in inside QuickBooks too, sending Mallet’s hours as well would pay the same hours
          twice — pick one place to track time before switching this on.
        </p>
      )}

      <section>
        <div style={{ fontWeight: 700, fontSize: "var(--type-base)" }}>File hours under</div>
        <div style={{ ...note, margin: "var(--space-1) 0 var(--space-2)" }}>
          QuickBooks puts every time entry against a service. Pick the one your crew’s labour
          belongs to.
        </div>
        <SelectMenu
          value={s.defaultItemQboId ?? ""}
          disabled={setItem.isPending}
          placeholder="Choose a service…"
          aria-label="QuickBooks service"
          onChange={(v) => {
            const item = s.items.find((i) => i.id === v);
            if (item) {
              setError(null);
              setItem.mutate({ qboId: item.id, name: item.name });
            }
          }}
          options={s.items.map((i) => ({ value: i.id, label: i.name }))}
        />
      </section>

      <section>
        <div style={{ fontWeight: 700, fontSize: "var(--type-base)" }}>
          Match your crew ({matched}/{s.crew.length})
        </div>
        <div style={{ ...note, margin: "var(--space-1) 0 var(--space-2)" }}>
          Anyone left unmatched keeps their hours in Mallet — they just won’t reach QuickBooks.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {s.crew.map((c) => {
            const person = s.people.find((p) => p.id === c.qboId);
            return (
              <div
                key={c.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                }}
              >
                <span style={label}>{c.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {/* QuickBooks silently won't carry time into payroll for a person whose "use
                      time data to create paychecks" flag is off — say so rather than let their
                      hours land somewhere that never reaches a paycheck. */}
                  {person && person.usesTimeForPaychecks === false && (
                    <span style={{ ...note, color: "var(--red)" }}>
                      not set to use time for pay
                    </span>
                  )}
                  <SelectMenu
                    aria-label={`QuickBooks match for ${c.name}`}
                    value={c.qboId ?? ""}
                    disabled={linkPerson.isPending}
                    onChange={(v) => {
                      setError(null);
                      const picked = s.people.find((p) => p.id === v);
                      linkPerson.mutate({
                        userId: c.userId,
                        qboId: picked?.id ?? null,
                        qboName: picked?.displayName ?? null,
                        qboKind: picked?.kind ?? null,
                      });
                    }}
                    options={[
                      { value: "", label: "Not matched" },
                      // Grouped so employees — the common case — are not buried among 1099 subs.
                      ...s.people
                        .filter((p) => p.kind === "Employee")
                        .map((p) => ({ value: p.id, label: p.displayName, group: "Employees" })),
                      ...s.people
                        .filter((p) => p.kind === "Vendor")
                        .map((p) => ({ value: p.id, label: p.displayName, group: "Contractors (1099)" })),
                    ]}
                    compact
                  />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div style={{ fontWeight: 700, fontSize: "var(--type-base)" }}>File invoices under</div>
        <div style={{ ...note, margin: "var(--space-1) 0 var(--space-2)" }}>
          QuickBooks puts every invoice line against a service too. This is separate from the one
          above — that one is your crew&apos;s labour, this one is what you bill.
        </div>
        <SelectMenu
          value={s.defaultInvoiceItemQboId ?? ""}
          disabled={setInvItem.isPending}
          placeholder="Choose a service…"
          aria-label="QuickBooks service"
          onChange={(v) => {
            const item = s.items.find((i) => i.id === v);
            if (item) {
              setError(null);
              setInvItem.mutate({ qboId: item.id, name: item.name });
            }
          }}
          options={s.items.map((i) => ({ value: i.id, label: i.name }))}
        />
        <div style={{ ...note, marginTop: "var(--space-2)" }}>
          Every line goes under this one item for now. Mallet&apos;s invoice lines don&apos;t name a
          pricebook item, so there is nothing to match them against yet.
        </div>
      </section>

      <section>
        <button
          className={s.sendInvoices ? "btn quiet" : "btn primary"}
          disabled={setSendInv.isPending || setInvItem.isPending || !s.defaultInvoiceItemQboId}
          onClick={() => {
            setError(null);
            setSendInv.mutate({ on: !s.sendInvoices });
          }}
        >
          {s.sendInvoices ? "Stop sending invoices" : "Start sending invoices"}
        </button>
        <div style={{ ...note, marginTop: "var(--space-2)" }}>
          {s.sendInvoices
            ? "Sending an invoice puts it in QuickBooks, with its tax and its customer."
            : "Off — nothing is being sent. Choose an item above first."}
        </div>
      </section>

      <section>
        <button
          className={s.sendApprovedHours ? "btn quiet" : "btn primary"}
          disabled={setSend.isPending || setItem.isPending || !s.defaultItemQboId}
          onClick={async () => {
            setError(null);
            // The dropdown may be showing QuickBooks' own default, which we display but have not
            // stored. Commit it first — otherwise the server refuses, having never been told.
            if (!s.sendApprovedHours && s.defaultItemQboId && !s.defaultItemSaved) {
              const name =
                s.defaultItemName ?? s.items.find((i) => i.id === s.defaultItemQboId)?.name;
              if (name) {
                await setItem.mutateAsync({ qboId: s.defaultItemQboId, name });
              }
            }
            setSend.mutate({ on: !s.sendApprovedHours });
          }}
        >
          {s.sendApprovedHours ? "Stop sending hours" : "Start sending approved hours"}
        </button>
        <div style={{ ...note, marginTop: "var(--space-2)" }}>
          {s.sendApprovedHours
            ? "Approving a week sends those hours to QuickBooks. Stop entering them by hand."
            : "Off — nothing is being sent. Turn this on once your crew is matched."}
        </div>
      </section>

      {error && (
        <p style={{ ...label, color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
