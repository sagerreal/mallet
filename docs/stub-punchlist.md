# Stub punch list (platform-wide sweep, 2026-07-12)

Every user-facing dead control / silent-data-loss path / partial feature found by the
full-codebase sweep. Check items off (or delete the control) as they're fixed. Line numbers
drift — grep the label.

## Tier 1 — dead controls (visible, clickable, do nothing)

Settings (`app/(office)/settings/page.tsx`):
- [ ] "Full demo — new customer to paid" + "AI Front Desk" guided-demo buttons (~L71, 74)
- [ ] "Forward your existing number" / "Port your number in" (~L522, 524)
- [ ] "Connect" ×4 — Angi, Thumbtack, Google LSA, Yelp marketplaces (~L539)
- [ ] "Import from QuickBooks" / "Google Contacts" / "Upload a spreadsheet" (~L547–549)
- [ ] Pipeline stage "Rename" / "+ Add a stage" (~L614, 629)
- [ ] "paste an SOP" link, Visit checklists (~L661)
- [ ] "Upload price book" (~L826)
- [ ] Custom fields (person + company): inputs don't capture keystrokes, "+ Add" ×2 dead (~L1022–1037)

Elsewhere:
- [ ] "Offer financing" + "Connect QuickBooks" (`features/money/money-ledger.tsx` ~L48, 51)
- [ ] 🎤 Dictate ×2 (`app/(office)/composer/page.tsx` — no speech API)
- [ ] "Save to book" on composer quote lines (needs pricebook wiring)
- [ ] "Text receipt" after payment (`components/modals/close-out-modal.tsx` ~L661)
- [ ] Notifications bell — no onClick at all (`components/shell/topbar.tsx` ~L97)
- [ ] Lead modal "Business" field — edits silently discarded (`lead-modal/more-details.tsx` ~L92)

## Tier 2 — works until refresh (silent data loss)

- [ ] My-day time clock (Travel/Break/Shop/start/stop) never writes time entries
      (`app/(field)/my-day/page.tsx` ~L100–190)
- [ ] Tech-job-modal field timer — Stop parks locally, never logs to timesheets
      (`components/modals/tech-job-modal.tsx` ~L218–285)
- [ ] Draft-invoice archive is store-local — the last TODO(persist)
      (`lib/store/slices/invoices-slice.ts` ~L397)

## Tier 3 — partial features

- [ ] Public quote page: optional add-ons are view-only for the customer; backend accept
      already supports tuned lines and the internal preview modal has working checkboxes —
      wire the public page (`app/(public)/q/[token]/page.tsx` ~L235)
- [ ] On-glass signature pad draws but never saves the signature
      (`components/modals/tech-quote-modal.tsx` ~L76–365)
- [ ] Checklist attach to jobs: "+ Add a checklist" is visible but the template picker is
      unwired — the checklists backend (Phase 6) exists; connect it
      (`job-modal.tsx` ~L542, `new-job-modal.tsx` ~L236/315/572)

## Tier 4 — invisible (comment-only markers, nothing renders; lowest urgency)

- cust-quote-modal: join-a-plan, financing "from $X/mo", request-a-change
- job-modal smartPanel: skills-gap banner, estimated-hours/split suggestion,
  signed-agreement viewer

Verified clean at sweep time: dashboard, customers, pipeline, jobs pages/tabs, tasks,
money detail, branding card.
