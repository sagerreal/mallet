# Mallet Prototype Interaction Map

Developer checklist: every interactive element in `elas-crm-prototype.html`, organized by surface so you can check off each one as it's rebuilt in React.

---

## 1. Global State Shape

### 1.1 DATA collections (persisted, serializable)

| Key | Shape / notable fields |
|-----|------------------------|
| `leads[]` | `{id, name, phone, source, stage, age, job, last, email, address, notes, acts[], evisits[], companyId, custom{}, brief[], noteLog[], card{brand,last4,via}, archived, trash, book, planId, unread, memberVisitUsed, scope{ans{}}}` |
| `companies[]` | `{id, name, terms, po, pastRevenue, sites[], archived}` |
| `estimates[]` | `{id, num, leadId, title, status(draft/sent/accepted/declined/superseded), age, viewed, viewsN, fu{on,stage}, lines[], pricing{disc,dep,tax}, gbb{rec,opts[]}, gbbType, gbbChosen, validDays, intro, terms, signed{by,when,via,sig}, depPaid, changeReq{comment,line,budget}, changes[], version, archived, trash}` |
| `tasks[]` | `{id, t, leadId, due, done}` |
| `jobs[]` | `{id, leadId, estId, title, addr, phone, status(unscheduled/scheduled/done), archived, svc(service/install), visits[], lines[], addons[], photos[], notes, jobNotes[], acts[], completion, invRequested, invoiceId, approvedOnSite, expected}` |
| `invoices[]` | `{id, num, jobId, leadId, cust, phone, email, title, lines[], total, depPaid, payments[], status(draft/sent), age, archived, fu{on,stage}, termsDays, pricing{}}` |
| `techs[]` | `{id, name, color, sells}` |
| `users[]` | `{id, name, role, phone, verified}` |
| `checklists[]` | `{id, name, trade, stage(scope/verify/prep), items[{id,text,type(text/photo/yn),required}]}` |
| `pricebook[]` | `{d, r, c, h, auto}` |
| `laborRates[]` | `{id, name, rate}` |
| `booking` | `{services[{name,lane(repair/estimate/flat),price,triggers}], notServices, serviceFee, feeCredited, hours{wdOpen,wdClose,satOpen,satClose,sunOpen,sunClose}, area{cities,radiusMi}}` |
| `brand` | `{site, name, initials, color, tagline}` |
| `termsLib[]` | `{t, body}` |
| `plans[]` | `{id, name, mo, disc, visits, perk}` |
| `timeEntries[]` | Timer clock-in/clock-out records |
| `channels` | `{angi, thumbtack, google-lsa, yelp}` — integration toggles |
| `fd` | `{on, mode(miss/always), drafts[]}` — AI Front Desk |
| `sources[]` | Lead source strings |
| `customFields[]` | `{key, label}` |
| `coCustomFields[]` | `{key, label}` |
| `customStages[]` | `{key, name, trigger, tkey, pos, norm, manual, hookId}` |
| `dashCards[]` | Dashboard card order preferences |
| `mcp[]` | MCP plugin registry |

### 1.2 UI STATE (ephemeral, not persisted)

| Key | Purpose |
|-----|---------|
| `view` | Current route (18 possible values) |
| `module` | Current module tab (`sales/operations/finance/admin`) |
| `role` | Current role (`owner/office/tech`) |
| `qaSource`, `qaBiz`, `qaSrcOpen`, `qaBook`, `qaMatch` | Quick-add form state |
| `composer` | New-quote form object (full shape) |
| `coOpen` | Open company panel ID |
| `boardQ` | Pipeline search string |
| `expandCols{}` | Expanded pipeline column IDs |
| `dragId` | Lead ID being dragged on pipeline |
| `cleanId` | Lead ID staged for clean-up |
| `simBusy` | Simulation spinner flag |
| `moreOpen` | More-menu open flag |
| `leadsQ`, `leadFilters{}`, `leadSort{}`, `filtersOpen`, `colsOpen`, `leadCols[]` | Customers list toolbar state |
| `jobsQ`, `jobFilters{}`, `jobSort{}`, `jobFiltersOpen`, `jobColsOpen`, `jobCols[]` | Jobs list toolbar state |
| `invQ`, `invFilters{}` | Invoices toolbar state |
| `scopeOn` | Visit-checklist feature flag |
| `verifyOn` | Job-verify feature flag |
| `autoRemind` | Auto payment-reminder flag |
| `custSeg` | Customer/company selector (`people/biz`) |
| `activeCall` | Live call object `{leadId, sec, notes}` |
| `attSnooze{}`, `attAll` | Attention card snooze state |
| `aiOpen`, `aiMsgs[]`, `aiBusy` | AI command bar state |
| `aiPlugOpen`, `aiRec` | AI plugin panel / recording flags |
| `cmdOpen` | Command bar open flag |
| `signedUp`, `onboard{}` | Sign-up wizard state |
| `weekStart` | Schedule week ISO date |
| `tsWeek` | Timesheet week ISO date |
| `schedView` | `day` or `week` |
| `jobDrag` | `{kind,id}` drag state for schedule |
| `myTech` | Tech ID for role=tech |
| `opsAI{}` | AI suggestions flags |
| `perms{}` | Role permissions `{techSeesPrice, techTexts}` |
| `nextEstNum`, `nextId`, `nextInvNum` | ID counters |
| `quoteDefaults{}` | Remembered quote options |
| `fieldUse{}` | Custom-field use counter |
| `norms{}`, `normsLearned` | Stage-duration norms |
| `tq` | Tech on-site quote builder state |
| `_coUI`, `_billDraft`, `_closeOut` | Close-out sheet state |
| `tour`, `tourMin`, `tourHideCoach` | Demo tour state |
| `setTab` | Settings active tab |
| `promotedByUse`, `flashCo` | Companies-promoted UI flag |
| `gbbPref{}`, `gbbDemotes{}` | GBB default preferences |
| `pbReview`, `pbAccepts` | Pricebook decompose review state |
| `_invPb`, `_invPx`, `_armCharge` | Invoice UI state |
| `_vsLead`, `_vsPurpose`, `_vsSel` | Visit-booking sheet state |
| `_routePrev` | Booking playbook route-preview input |
| `fd` (UI sub-fields) | Front Desk draft state |

---

## 2. Navigation & View System

### 2.1 View router

`render()` dispatches to one of 18 view functions:

| `state.view` | Function | Module |
|---|---|---|
| `home` | `vHome()` | sales |
| `pipeline` | `vPipeline()` | sales |
| `leads` | `vLeads()` | sales |
| `estimates` | `vEstimates()` | sales |
| `tasks` | `vTasks()` | sales |
| `settings` | `vSettings()` | sales |
| `composer` | `vComposer()` | sales |
| `admin-team` | `vAdminTeam()` | admin |
| `ops-home` | `vOpsHome()` | operations |
| `ops-schedule` | `vSchedule()` | operations |
| `ops-jobs` | `vJobs()` | operations |
| `ops-myday` | `vMyDay()` | operations |
| `ops-mytime` | `vMyTime()` | operations |
| `ops-messages` | `vMessages()` | operations |
| `ops-timesheets` | `vTimesheets()` | operations |
| `fin-money` | `vMoney()` | finance |
| `fin-invoices` | `vInvoices()` | finance |

Navigation functions:
- `go(v)` — sets `state.view`, derives `state.module` from `VIEW_MODULE`, calls `render()`. Special cases: `go('intake')` redirects to `settings?tab=sources`; `go('companies')` sets `custSeg='biz'` then routes to `leads`.
- `setModule(m)` — guards with `roleCan(m)`, sets `state.module`, jumps to `defaultView(m)`.

### 2.2 Role-based access

| Role | Allowed modules | Default home |
|---|---|---|
| `owner` | sales, operations, finance, admin | `{m:'sales',v:'home'}` |
| `office` | sales, operations, finance | `{m:'sales',v:'home'}` |
| `tech` | operations only | `{m:'operations',v:'ops-myday'}` |

### 2.3 Sidebar nav / mobile tabs

Module area doors (rendered by `renderSalesNav`, `renderOpsNav`, `renderFinanceNav`):

**Sales module tabs** (appear as sub-nav inside sidebar):
- Pipeline → `go('pipeline')`
- Estimates → `go('estimates')`
- Tasks → `go('tasks')`

**Operations module tabs**:
- Schedule → `go('ops-schedule')`
- Work → `go('ops-home')`
- Timesheets → `go('ops-timesheets')`
- My Day → `go('ops-myday')` (tech role only)
- My Time → `go('ops-mytime')` (tech role only)
- Messages → `go('ops-messages')` (tech role only)

**Finance module tabs**:
- Money → `go('fin-money')`
- Invoices → `go('fin-invoices')`

### 2.4 `+ New` dropdown menu

Toggle: `toggleNewMenu()` — sets `state.newMenu`

Items:
| Label | Action |
|---|---|
| New customer | `openQuickAdd()` |
| New quote | `startComposer()` |
| New job | `openNewJob()` (ops-only) |
| New invoice | `newInvoice()` (finance-only) |

### 2.5 Role switcher

Visible in dev/demo only. `setRole(r)` — sets `state.role`, adjusts `state.module` if needed, re-renders.

---

## 3. Overlay / Modal System

Mechanism: `openOv(id)` adds class `open` to `#id`; `closeOv(id)` removes it. CSS: `.overlay { display:none } .overlay.open { display:flex }`.

| Overlay ID | What it is | What opens it | Key actions inside |
|---|---|---|---|
| `ovQuick` | New customer form | `openQuickAdd(pre?)` from `+ New` menu, FD approve, tour | Name/phone/job inputs; source picker with `qaSrcToggle/Pick/Add`; Person/Biz toggle; Book-a-visit reveal; More details reveal; `saveQuickAdd()` on Create button |
| `ovLead` | Lead / customer detail | Row click on pipeline/leads; `openLead(id)` | Call button → `openCallSheet(id)`; Text button → `openThread(id)`; Book site visit → `openVisitSheet(id)`; New quote → `startComposer(id)`; Quote row click → `openEst(id)`; Visit open → `openEvisit(id,vid)`; Name/phone inline edit; Stage pill; Notes timeline + add note; Next step block with tasks; More details reveal (email, address, biz, custom fields); Clean up → `ovClean`; Delete → `armLeadDel(id)` |
| `ovEst` | Estimate detail | Row click on estimates; `openEst(id)` | Line-items table; Follow-up trail; Preview as customer → `openCust(id)`; Simulate view → `simView(id)`; Simulate days → `simDays(id)`; Simulate accept → `simAccept(id)`; Send draft → `sendDraft(id)`; Revise → `reviseQuote(id)`; Delete → `armEstDel(id)` |
| `ovCust` | Customer-facing quote page | `openCust(id)`, `openCustPreview(temp)`, `previewComposer()`, `openCustLocked(id)` | GBB tier picker (3 cards); tune-able line checkboxes; optional add-on checkboxes; plan join toggle; Approve button → `approveCust()` or `approveGbbSel()`; Request a change → textarea + `gbbReqSend(id)`; None of these → decline-reason chips → `gbbDeclineAll(reason)`; Single-quote approve → signature → `openSignSheet(id)` |
| `ovSign` | Signature pad (quote acceptance) | `openSignSheet(estId, opts?)` | Canvas signature pad; quote summary; "Accept & sign" → `signComplete(estId)` |
| `ovCall` | Call sheet | `openCallSheet(leadId)` | Two paths: "Call from Mallet" → `startCall(id)` (live call bar); "Log a call" → `logCallForm(id)` → outcome chips, direction, duration, when, notes → `saveLoggedCall(id)` |
| `ovThread` | SMS thread | `openThread(leadId)` | Message history; compose input → `sendText(id)` on Enter/Send; "Simulate a reply" → `simReply(id)`; "Simulate reply while away" → `simReplyAway(id)` |
| `ovJob` | Job detail (office view) | `openJob(jobId)` | Call/Text buttons; title/type/address inputs; visit rows with date/crew/start/length controls; + Add a visit; "Price it" → `openTechQuote(id)` or inline; note feed + add note + photo; checklist block; money pointer link; "Save all to pricebook" → `jobPbSaveAll(id)`; addon rows (approve/decline); Done / Log as done button; Delete |
| `ovEvisit` | Estimate-visit detail | `openEvisit(leadId, visitId)` | Office view: schedule controls, scope status, photo capture; Tech view: arrived timer, "what you found" textarea, scope checklist items, photo upload, add-on proposal, "Send to office" / "Price it on site" |
| `ovInv` | Invoice detail / close-out | `openInvoice(invId)` or `openCloseOut(jobId)` | "What was done" input; bill-ask block (flat/itemize mode); add-on settle (include/skip); Send invoice; Take payment → `coPay()` flow (method picker → Tap to Pay / cash / check / bank / on-file → `coPayBlock`); Remind; Done |
| `ovLead` (also used as `ovTQ`) | Tech on-site quote | `openTechQuote(jobId)` | Build-the-price: Add a line (pricebook / custom / labor / custom labor); tier chips (Good/Better/Best); + Add a cheaper / premium option; Present to customer → `tqPresent()`; then: tier choice cards → `tqChoose(t)` → signature canvas → `tqSign()` |
| `ovStage` | Add pipeline stage | `openStageModal(step?)` | Template grid; Webhook stage form; Manual stage form; `addTemplateStage(key)`, `addHookStage()`, `addManualStage()` |
| `ovVisit` | Book a visit | `openVisitSheet(leadId)` | Job / Estimate visit tabs; open slots chips → `vsPickSlot()`; Day, Who goes, Start, Hours inputs; Address input; Book button → `saveVisit(id)` |
| `ovChk` | Checklist editor | `openChk(id)` | Add/edit/remove checklist items; required toggle; type select |
| `ovClean` | Archive / mark lost | `buildClean()` → `openOv('ovClean')` | Mark Lost (reason select); Archive; Cancel |
| `ovSweep` | Bulk clean-up | `openJobSweep()` or `openQuoteSweep()` | Select-all link; checkboxes; Delete checked / Archive checked |
| `ovForm` | Pricebook CSV import | `openPbImport()` | Preview table; Import button → `runPbImport()` |
| `ovTech` | Team member detail | Admin team view | Edit name/role/phone; resend invite |

---

## 4. Per-View Interaction Inventory

### 4.1 `vHome()` — Sales Home

| Element | Action | What happens |
|---|---|---|
| Attention items (missed texts, overdue reminders) | Click row | Opens lead/invoice/quote modal |
| "All" toggle | `state.attAll=!state.attAll` | Expands all attention cards |
| Snooze button on attention items | `attSnooze[id]=tomorrow` | Hides item until tomorrow |
| Needs attention overdue invoice row | `openInvoice(id)` | Opens invoice modal |
| KPI tile "Outstanding" | `go('fin-invoices')` | Opens invoices list |
| KPI tile "Sold · awaiting" | `setModule('operations')` | Switches to ops |
| Home quote tile (AI Front Desk draft) | "Book it" → `fdBook(draft.id)` | Creates customer + job, texts confirmation |
| Home quote tile "Decline" | `fdDecline(draft.id)` | Dismisses draft |
| Demo tour buttons | `startJobTour()` / `startEstimateTour()` | Launches guided tour |
| "Learn norms" link | `learnNorms()` | Updates stage-duration norms from history |

### 4.2 `vPipeline()` — Sales Pipeline (Kanban)

| Element | Action | What happens |
|---|---|---|
| Search input | `boardSearch(v)` | Filters cards live |
| Pipeline card | Click | `openLead(id)` |
| Pipeline card drag | `dragLead(ev, id)` / `dragEnd()` | Picks up card |
| Column drop zone | `dropLead(ev, stage)` | Moves lead to new stage; if stage="Won" → creates job |
| Trash drop zone | `dropTrash(ev)` | Opens `ovClean` with lead |
| "Clean up" button | `openClean()` or `openQuoteSweep()` | Opens sweep modal |
| "Attention" banner row | Click | `openLead(id)` |
| Stage column header count | Display only | — |
| "No leads in X" empty state | Display only | — |

### 4.3 `vLeads()` — Customers / Companies list

| Element | Action | What happens |
|---|---|---|
| Person / Company tab | `state.custSeg='people'` or `'biz'` | Switches list |
| Search input | `leadSearch(v)` | Filters live, preserves cursor |
| Filters button | `state.filtersOpen=!state.filtersOpen` | Expands filter panel |
| Filter: Stage select | `setLeadFilter('stage', v)` | Filters list |
| Filter: Source select | `setLeadFilter('source', v)` | Filters list |
| Filter: Type select | `setLeadFilter('type', v)` | Filters list |
| Filter: Member select | `setLeadFilter('member', v)` | Filters list |
| Filter: Custom field key/value | `setLeadFilter('cfKey'/'cfVal', v)` | Filters list |
| Clear all filters | `clearLeadFilters()` | Resets all filters |
| Columns button | `state.colsOpen=!state.colsOpen` | Opens column picker |
| Column checkbox | Toggles `state.leadCols` | Shows/hides column |
| Table header click | `sortLeads(col)` | Toggles sort direction |
| Table row click | `openLead(id)` | Opens lead modal |
| Company row click | `openCo(id)` | Opens company panel |
| "+ New" inline | `openQuickAdd()` | Opens quick-add form |
| Export CSV link | `exportLeadsCsv()` | Downloads leads CSV |

### 4.4 `vEstimates()` — Quotes list

| Element | Action | What happens |
|---|---|---|
| Filter tabs (All / Active / Drafts / Won / Attention) | `state.quoteFilter=v` | Filters list |
| "Clean up" button | `openQuoteSweep()` | Opens sweep modal |
| "+ New quote" button | `startComposer()` | Opens composer |
| Quote row click | `openEst(id)` | Opens estimate modal |
| Follow-up trail dots | Display only | — |
| Viewed badge | Display only | — |

### 4.5 `vTasks()` — Tasks list

| Element | Action | What happens |
|---|---|---|
| Task row click | `openLead(t.leadId)` | Opens lead modal |
| Done button | `taskDone(id)` | Marks task done |
| Snooze button | `taskSnooze(id)` | Postpones to tomorrow |
| "+ Add task" form | `addTask({t, due})` | Creates new task |
| Overdue indicator | Display only (red text) | — |

### 4.6 `vSettings()` — Settings (7 tabs)

Settings tabs: `state.setTab` = `workspace / sources / pipeline / pricing / booking / fields / archive`

**Workspace tab:**
| Element | Action | What happens |
|---|---|---|
| Branding reveal | Expand | Shows brand name/color/tagline |
| "Preview a quote" | `previewBrandQuote()` | Opens customer-facing quote preview |
| "Full demo" button | `startJobTour()` | Launches V1 tour |
| "AI Front Desk" button | `startEstimateTour()` | Launches V2 tour |
| Team & roles block (owner only) | Inline | Lists team members, invite form |

**Lead sources tab:**
| Element | Action | What happens |
|---|---|---|
| AI Front Desk toggle | `state.fd.on=!state.fd.on` | Enables/disables Front Desk |
| FD mode radio (miss / always) | `state.fd.mode=v` | Sets when AI answers |
| Channel toggles (Angi, Thumbtack, etc.) | `state.channels[k]=v` | Enables intake channel |
| Source list items "✕" | `removeSource(name)` | Removes source |
| Add source input + button | `addSourceFromSettings()` | Adds new source |

**Pipeline tab:**
| Element | Action | What happens |
|---|---|---|
| Stage row "Rename" | `toast(...)` | Explains built-in stages |
| Stage row "endpoint" | `showHook(key)` | Opens webhook detail modal |
| Stage row "✕" | `removeStage(key)` | Removes custom stage, returns cards to Contacted |
| "+ Add a stage" | `openStageModal()` | Opens stage-type picker |
| Visit checklist toggle | `state.scopeOn=!state.scopeOn` | Enables scope checklists |
| Checklist "Edit" | `openChk(id)` | Opens checklist editor |
| New checklist input + "Create blank" | `newBlankChecklist()` | Creates blank checklist |
| "Paste an SOP" link | `openSopPaste()` | Opens SOP paste UI |
| Visit lengths inputs | `setVisitDur(kind, min)` | Sets default block duration |

**Pricing & quotes tab:**
| Element | Action | What happens |
|---|---|---|
| Trade select | `setTradeFromSettings(v)` | Reloads pricebook + labor rates for trade |
| Labor rate rows: name/rate inputs | `setLaborField(id, f, v)` | Updates rate |
| Labor rate "✕" | `removeLaborRate(id)` | Removes rate |
| Add labor rate form | `addLaborRate()` | Adds new rate |
| Pricebook item: desc/price/cost inputs | `setPbField(i, f, v)` | Updates item |
| Pricebook item "✕" | `removePbItem(i)` | Removes item |
| Add pricebook item form | `addPbFromSettings()` | Adds item |
| "Upload price book" | `openPbImport()` | Opens CSV import modal |
| Default markup input | `state.markup=v; render()` | Sets markup % |
| Terms library: name/body inputs + Add | `addTermFromSettings()` | Adds term |
| Terms library row "✕" | `removeTerm(i)` | Removes term |

**Booking tab (owner only):**
| Element | Action | What happens |
|---|---|---|
| Services rows: name/lane/triggers inputs | `bkSetService(i, f, v)` | Updates service |
| Service lane select | `bkSetService(i, 'lane', v)` | Sets repair/estimate/flat |
| Service flat price input | `bkSetService(i, 'price', v)` | Sets flat price |
| Service "✕" | `bkRmService(i)` | Removes service |
| Add service input + button | `bkAddService()` | Adds service |
| "We don't do" input | `bkSetField('notServices', v)` | Sets exclusions |
| Route preview input + "Route it" | `state._routePrev=v; render()` | Shows routing result |
| Service-call fee input | `bkSetFee(v)` | Sets diagnostic fee |
| Fee credited toggle | `state.booking.feeCredited=v` | Sets fee-credit behavior |
| Hours inputs (weekday/sat/sun) | `bkSet('hours', k, v)` | Sets open/close hours |
| Cities input, Radius input | `bkSet('area', k, v)` | Sets service area |

**Custom fields tab:**
| Element | Action | What happens |
|---|---|---|
| Field row "✕" | `removeCustomField(key)` | Removes field |
| Add field input + button | `addCustomFieldFromSettings()` | Adds new field |
| Company custom field "✕" | `removeCoCustomField(key)` | Removes company field |
| Add company field | `addCoCfFromSettings()` | Adds company field |

**Archive tab:**
| Element | Action | What happens |
|---|---|---|
| Archived lead "↩ Restore" | `restoreLead(id)` | Restores lead |
| Archived quote "↩ Restore" | `restoreQuote(id)` | Restores quote |
| Archived company "↩ Restore" | `restoreCo(id)` | Restores company |
| Archived job "↩ Restore" | `restoreJob(id)` | Restores job |

### 4.7 `vComposer()` — New Quote builder

| Element | Action | What happens |
|---|---|---|
| Customer search input | `composerCustSearch(v)` | Live search, shows results dropdown |
| Customer result click | `composerPickCust(id)` | Links customer to quote |
| "+ Add new customer" | `composerNewCust()` | Creates customer on the spot |
| Change customer link | `composerClearCust()` | Clears customer |
| "3 options · GBB" button | `composerAccel('gbb')` | Switches to GBB mode |
| "Draft with AI" button | `composerAccel('ai')` | Toggles AI panel |
| AI desc textarea | Update `c.desc` | — |
| "Draft lines" button | `aiDraft()` | 1.4s delay → fills lines from pricebook |
| "Dictate" button | `descMic()` | Voice recognition → fills textarea |
| "From a template" button | `composerAccel('tmpl')` | Toggles template grid |
| Template button | `useTmpl(k)` | Copies template lines |
| Photo attach button | `cmpAddPhoto()` | Adds photo thumb |
| Photo remove "×" | `cmpRmPhoto(i)` | Removes photo |
| Line item: description input | `c.lines[i].d=v` | Updates description |
| Line item: qty input | `c.lines[i].q=+v; render()` | Updates qty + recalcs |
| Line item: price input | `c.lines[i].r=+v; render()` | Updates price + recalcs |
| Line item: cost input | `setLineCost(i, v)` | Updates cost, suggests price at markup |
| Line item: "Make optional" button | `c.lines[i].opt=!c.lines[i].opt` | Toggles optional flag |
| Line item: "+ Photo" button | `c.lines[i].photo=!c.lines[i].photo` | Attaches photo to line |
| Line item: "Save to book" button | `savePbLine(i)` | Saves line to pricebook |
| Line item: "✕" | `c.lines.splice(i,1); render()` | Removes line |
| "+ Add line" button | `c.lines.push({d:'',q:1,r:0}); render()` | Adds blank line |
| "From pricebook" button | `c.pbOpen=!c.pbOpen; render()` | Toggles pricebook picker |
| Pricebook item chip | `addPbToQuote(i)` | Copies pricebook item to lines |
| Pricebook decompose review: "Looks right" | `pbAcceptDecomp()` | Saves formula |
| Pricebook decompose: "Fix" | `state.pbReview.fix=true; render()` | Opens hour/cost inputs |
| Pricebook decompose: "no formula" | `pbDismissDecomp()` | Dismisses |
| Auto follow-up toggle | `c.fuOn=!c.fuOn; render()` | On/off |
| Pricing options reveal | `c.priceOpen=!c.priceOpen; render()` | Expands |
| Discount / Deposit / Tax inputs | `setPricing(k, v)` | Recalcs totals |
| Message & terms reveal | `c.msgOpen=!c.msgOpen; render()` | Expands |
| Intro textarea | `c.intro=v` | Sets custom intro |
| Terms select | `c.terms=+v; render()` | Sets terms |
| Valid days input | `c.validDays=Math.max(1,+v); render()` | Sets expiry |
| Email input (if no email on file) | Saves to lead on send | — |
| Preview button | `previewComposer()` | Opens customer-facing preview |
| Save draft button | `saveDraftComposer()` | Saves as draft, goes to estimates |
| Send quote button | `sendComposer()` | Validates → texts quote link → goes to pipeline |

**GBB sub-mode (when `c.mode='gbb'`):**
| Element | Action | What happens |
|---|---|---|
| Description textarea | `c.desc=v` | — |
| "Build 3 options" button | `gbbDraft()` | 1.4s delay → builds Good/Better/Best |
| "Dictate" button | `descMic()` | Voice input |
| GBB review: Edit button | `gbbEditTier(k)` | Enters single-tier editing |
| GBB review: "★ Recommend this" | `gbbMakeRec(k)` | Changes recommended tier |
| GBB review: "use a single quote instead" | `gbbSingleInstead()` | Collapses to single-tier; tracks preference |
| GBB review: "← back to all 3" (in edit) | `gbbBackFromTier()` | Returns to 3-tier view |
| Preview as customer | `previewComposer()` | Opens customer-facing GBB view |
| Send all 3 | `sendComposer()` | Sends GBB quote |

### 4.8 `vOpsHome()` — Work (Operations Home)

| Element | Action | What happens |
|---|---|---|
| Unscheduled job row | Click | `openJob(id)` |
| "Drag to the schedule" hint | Display only | — |
| Scheduled job row | Click | `openJob(id)` |
| Done job row | Click | `openJob(id)` |
| "Ready to invoice" CTA | `createInvoiceFromJob(id)` | Creates invoice + opens it |
| "Clean up jobs" button | `openJobSweep()` | Opens sweep modal |
| "+ New job" button | `openNewJob()` | Creates unscheduled job |
| AI suggestions toggle | `state.opsAI.estimate=!state.opsAI.estimate` | Shows AI estimate banner |

### 4.9 `vSchedule()` — Schedule (Day/Week view)

| Element | Action | What happens |
|---|---|---|
| Day / Week toggle | `state.schedView='day'/'week'; render()` | Switches view |
| Previous / Next week/day buttons | Adjusts `state.weekStart` | Navigates calendar |
| "Today" button | `state.weekStart=todayISO(); render()` | Jumps to today |
| Unplaced job block drag | `visitDragStart(ev, id)` | Picks up job |
| Schedule hour cell drop | `visitDropHour(ev, techId, iso, hour)` | Places visit |
| Day column drop (week view) | `jobDrop(ev, techId, iso)` | Places visit on day |
| Visit block click | `openJob(jobId)` | Opens job modal |
| Visit block resize handle | `blockResizeStart(ev, vId)` → `blockResizeMove` → `blockResizeEnd` | Adjusts duration |
| Estimate-visit block drag | `evisitDragStart(ev, id)` | Picks up estimate visit |
| Estimate-visit block click | `openEvisit(leadId, visitId)` | Opens evisit modal |
| "Book visit" inline | `openVisitSheet(leadId)` | Opens visit-booking modal |
| "New job" button in schedule | `openNewJob()` | Creates unscheduled job |

### 4.10 `vJobs()` — Jobs list

| Element | Action | What happens |
|---|---|---|
| Search input | `jobSearch(v)` | Filters live |
| Filters button | `state.jobFiltersOpen=!state.jobFiltersOpen` | Expands filter panel |
| Filter: Status select | `setJobFilter('status', v)` | Filters list |
| Filter: Type select | `setJobFilter('type', v)` | Filters list |
| Filter: Crew select | `setJobFilter('crew', v)` | Filters list |
| Clear filters | `clearJobFilters()` | Resets |
| Columns button | `state.jobColsOpen=!state.jobColsOpen` | Opens column picker |
| Table header click | `sortJobs(col)` | Toggles sort |
| Job row click | `openJob(id)` | Opens job modal |
| "+ New job" button | `openNewJob()` | Creates job |
| Export CSV | `exportJobsCsv()` | Downloads CSV |

### 4.11 `vMyDay()` — Tech: My Day

| Element | Action | What happens |
|---|---|---|
| Today's visit block | Click | `openJob(id)` or `openEvisit(id,vid)` |
| "Arrived" clock button | `visitTimerStart(visitId)` | Starts clock-in timer |
| "Done" clock button | `visitTimerEnd(visitId)` | Stops clock, marks done |
| Timer display | Live update via `setInterval` | Shows hh:mm:ss |
| Ask Mallet (command bar) | `cmdOpen=true; cmdShow()` | Opens AI bar focused on this job |
| Job note add | `addJobNote(id)` | Posts note to shared feed |
| Checklist item checkbox | `jobCheckItem(jobId, itemId)` | Marks item done |
| Photo button | `jobPhoto(id)` | Adds photo |

### 4.12 `vMyTime()` — Tech: My Time

| Element | Action | What happens |
|---|---|---|
| Clock-in button | `clockIn(techId)` | Starts time entry |
| Clock-out button | `clockOut(techId)` | Ends time entry |
| Week navigation | Adjusts `state.tsWeek` | Navigates |
| Time entry edit | Inline inputs | Adjusts hours |

### 4.13 `vMessages()` — Tech: Messages

| Element | Action | What happens |
|---|---|---|
| Thread row click | `openThread(leadId)` | Opens SMS thread |
| Unread badge | Display only | — |
| Compose in list | `sendText(id)` | Sends message |

### 4.14 `vTimesheets()` — Timesheets

| Element | Action | What happens |
|---|---|---|
| Week navigation | Adjusts `state.tsWeek` | Navigates |
| Approve week button | `tsApprove(techId)` | Marks week approved |
| Un-approve | `tsUnapprove(techId)` | Reverts approval |
| Time entry rows | Inline edits | Adjust clock-in/out |
| Export CSV | `tsCsvExport()` | Downloads timesheet CSV |
| "Open timesheets" from Money | `go('ops-timesheets')` | Navigates |

### 4.15 `vMoney()` — Money dashboard

| Element | Action | What happens |
|---|---|---|
| KPI "Outstanding" tile | `go('fin-invoices')` | Navigates to invoices |
| KPI "Sold · awaiting" tile | `setModule('operations')` | Switches module |
| Auto-reminders toggle | `state.autoRemind=!state.autoRemind; render()` | Enables/disables auto-follow-up |
| "Open timesheets" | `go('ops-timesheets')` | Navigates |
| Ready-to-bill row "Create invoice" | `createInvoiceFromJob(jobId)` | Creates + opens invoice |
| Draft invoice "Finish & send" | `openInvoice(id)` | Opens invoice modal |
| Open invoice row "Remind" | `remindInvoice(id)` | Texts payment reminder |
| Open invoice "Charge ···· XXXX" (1 of 2 taps) | Arms confirm | Shows confirm button |
| Open invoice "Confirm — charge" (2nd tap) | `chargeOnFile(id)` | Charges card on file |
| Open invoice "Take payment" | `openInvoice(id)` | Opens invoice modal |
| "Offer financing" button | `financeConnect()` | Enables financing feature |
| "Connect QuickBooks" button | `qbConnect()` | Enables QB sync |

### 4.16 `vInvoices()` — Invoices list

| Element | Action | What happens |
|---|---|---|
| Search input | `invSearch(v)` | Filters live |
| Filters button | `state.invFiltersOpen=!state.invFiltersOpen; render()` | Expands filter |
| Filter: Status select | `setInvFilter('status', v)` | Filters list |
| Clear filters | `clearInvFilters()` | Resets |
| Invoice row click | `openInvoice(id)` | Opens invoice modal |
| "+ New invoice" button | `newInvoice()` | Creates blank draft invoice |
| "Offer financing" button | `financeConnect()` | Enables financing |
| "Connect QuickBooks" button | `qbConnect()` | Enables QB sync |

### 4.17 `vAdminTeam()` — Team (admin/owner only)

| Element | Action | What happens |
|---|---|---|
| Team member row | Click / edit inline | Edit name/role/phone |
| Resend invite | `resendInvite(id)` | Sends invite text |
| "+ Invite" form | `inviteTeam()` | Adds new user |
| Role select | `setUserRole(id, role)` | Changes role |
| Tech permissions toggles | `state.perms.techSeesPrice`, `state.perms.techTexts` | Sets perms |
| Remove member | `removeUser(id)` | Removes user |

---

## 5. Modal Deep Dives

### 5.1 `openJob()` — Job modal (office view)

Sections in order:
1. **Header**: customer name (link → `openLead`), Call button → `openCallSheet`, Text button → `openThread`
2. **Title / type inputs**: inline editable (`jobSetField`)
3. **Address input**: inline editable, map link
4. **Visit rows**: each visit has date picker, crew select (`setVisitTech`), start time, duration; status pill; clock display. "Remove visit" × button.
5. **"+ Add a visit"** → `addVisit(jobId)` — adds unscheduled visit
6. **Price block**: "Price it" button → `openTechQuote(jobId)` or `startComposer(leadId)`. If lines exist: table with amounts. "Save all to pricebook" → `jobPbSaveAll`.
7. **Add-on rows** (found work): "approve" → `approveAddon`; "decline" → `declineAddon`; propose button
8. **Note feed + inputs**: shared office/tech feed, "Add note" input, "+ Photo"
9. **Checklist block**: verify checklist items with checkboxes and override chips
10. **Money pointer**: link to open invoice → `openInvoice`; or "Bill it in Money →" link
11. **Footer**: "Done" → marks job done; "Delete" → archives job; close ✕

### 5.2 `openEvisit()` — Estimate visit modal

**Office view** (same structure as openVisitSheet but for an existing visit):
- Scope status display, checklist items
- Date/crew/start/duration controls
- "Complete visit" → marks as done + scoped

**Tech/field view**:
1. **Timer**: Arrived / Done clock buttons with elapsed time
2. **"What did you find?"** textarea → `scopeNotes`
3. **Photos**: up to 3 capture buttons → `visitPhoto`
4. **Scope checklist**: item-by-item with checkbox/photo/note answers
5. **"Price it on site"** reveal (if `tech.sells`): opens `openTechQuote` inline
6. **Add-on proposal**: "Found extra work" → adds to job.addons
7. **"Send to office"** button → `sendForInvoicing` or marks visit done

### 5.3 `openLead()` — Lead modal (full detail)

Key interactive zones:
- **Name** inline edit (`saveLeadName`)
- **Phone** inline edit (`saveLeadField('phone')`)
- **Stage pill** (display)
- **Source pill** (display)
- **Plan badge** (display)
- **Company pill** → `openCo(id)`
- **Call button** → `openCallSheet(id)`
- **Text button** (with unread badge) → `openThread(id)`
- **"Book site visit"** button → `openVisitSheet(id)` (only if not Won/Lost)
- **"New quote"** button → `startComposer(id)`
- **Quote rows** → `openEst(id)`
- **Site visit card**: visit rows with "Open" → `openEvisit` and "Quote" → `startComposer`
- **Note timeline**: chronological feed; add-note input
- **Next step block**: suggested action buttons; task checkboxes → `taskDoneLead`; "+ Add a task" inline
- **Scope section** (if enabled): checklist status, expand items
- **"More details" reveal**: email, address, business link/input, plan membership, custom fields, "+ Add a custom field"
- **Footer**: "Clean up — mark Lost or Archive" → `ovClean`; Delete → `armLeadDel`

### 5.4 `openCallSheet()` — Call modal

Two-path picker:
1. **"Call from Mallet"** → `startCall(id)`: opens floating call bar; live timer; notes textarea; "End call" → outcome chips → `finishCall(outcome)`
2. **"Log a call"** → `logCallForm(id)`: outcome chips (`lcPick`); direction select; duration input; when select; notes textarea; Save → `saveLoggedCall(id)`

### 5.5 `openThread()` — SMS thread

- Message history (calls shown as system rows, texts as bubbles)
- Compose input → `sendText(id)` on Enter or Send button
- "Simulate a reply" → `simReply(id)` (demo only)
- "Simulate reply while away" → `simReplyAway(id)` (sets unread flag, closes modal)

### 5.6 `openInvoice()` — Invoice modal

**For job-linked invoices** (not directly editable):
- Invoice number / customer / status header
- Line-items table (read-only)
- Deposit and payment credits
- Pending add-ons: "Customer OK'd — include" → `invIncludeAddon`; "Leave off" → `invSkipAddon`
- Payment reminders trail (if sent)
- "Send invoice" button (if draft + has total) → `sendInvoice(id)` → texts pay link
- "Take payment" → `coPay(null, 'open')` → opens `coPayBlock`:
  - Amount input
  - Method buttons: "Charge [card on file]" → `coPay('onfile')`; "Tap to Pay" → `coPay('tap')`; Cash → `coPay('cash')`; Check → `coPay('check')`; Bank → `coPay('ach')`
  - Tap-to-Pay screen: contactless icon, "Simulate tap →" → `coPay('approve')` → done screen
  - Done screen: receipt, "Text receipt" → `sendReceipt(id)`; Done → `coPay('finish')`
- "Remind" button → `remindInvoice(id)`
- Done → `closeOv('ovInv')`

**For hand-made draft invoices** (`invEditBlock`):
- "Bill to" input with datalist autocomplete → `invCustPick(id, name)`
- Phone input → `invSetField(id, 'phone', v)`
- Email input → `invSetField(id, 'email', v)`
- Terms select → `invSetTerms(id, days)`
- Line items: description, qty, price, cost inputs → `invSetLine(id, ix, k, v)`
- Remove line "✕" → `invRemoveLine(id, ix)`
- "+ Add line" → `invAddLine(id)`
- "From pricebook" → `invPbOpen(id)` → pricebook items → `invPbAdd(id, pi)`
- Discount/tax/deposit-paid inputs → `invSetPricing(id, k, v)`
- Send invoice button → `sendInvoice(id)`

### 5.7 `openCloseOut()` — Close-out / wrap-up sheet

Opened from job completion. Contains:
- "What was done" input → `completionNote(jobId)` (goes on invoice)
- **Bill-ask block** (if no price set): One price / Itemize tabs → `setBillMode(mode, jobId)`
  - Flat mode: amount input, suggested price; "Set the bill" → `invSetBill(invId, jobId)`
  - Itemize mode: labor lines (h × rate), flat items, material; "Use this bill" → `commitBill(invId, jobId)`. Chip buttons: "+ Labor" → `billAddLabor`; preset buttons → `billPreset`; add flat line → `billAddFlat`; remove line → `billLineRm`
- **Add-on settle block**: include / leave-off buttons
- **Money total** display
- **Payment section**: "Take payment — $X" → `coPay(jobId, 'open')` or "Text the bill" → `sendInvoice(invId)`
- **Open checks reveal**: gap items with "✓ done" and override chips (N/A / Customer declined / Photo unclear) → `jobOverride`
- **Hours display**: adjust link → inline h/m inputs → `coSetHM`
- ✕ closes overlay

### 5.8 `openVisitSheet()` — Book a visit

- Job / Estimate visit chips → `vsPurpose('fix'/'look')`
- Open slot chips → `vsPickSlot(iso, h, techId)`
- Day input → `vsSet('day', v)`
- Who goes select → `vsSet('techId', v)`
- Start time input → `vsSet('start', v)`
- Hours input → `vsSet('dur', v)`
- Availability line (shows conflicts in amber)
- Address input (pre-fills lead's address)
- "Book the job" / "Book the visit" → `saveVisit(leadId)` — creates job or evisit record

### 5.9 `openQuickAdd()` — New customer form

- Name input (required)
- Phone input → live dedupe check → `qaDedupe(phone)`
- "What's needed?" job description input → `routeIntake()` to suggest booking flow
- Source picker (custom dropdown): `qaSrcToggle`, `qaSrcPick(s)`, `qaSrcAdd()`, `qaSrcStarter()`, inline add form
- Person / Business type chips → `state.qaBiz=!state.qaBiz`; Business name input with datalist
- "Book a visit?" reveal → flow chips (Job / Estimate visit); open slot chips; day/start/hours inputs; address input
- "More" reveal → email, notes, custom field rows
- Promoted custom fields (if any)
- Create button → `saveQuickAdd()`:
  - If booking flow selected → `bookDirect(name, hv)` (creates job/visit directly)
  - If repeat caller (dedupe match) → updates existing lead record
  - Otherwise → creates new lead, goes to pipeline

### 5.10 Customer-facing invoice page `renderCustInv()`

Opened via `openCustInv(id)` in ovCust overlay:
- Brand header
- Line items (read-only)
- Deposit and payment credits
- **Due total** (large)
- Verified-work proof section (photo-verified checklist items)
- Payment method chips (Card / Bank transfer) → `state.custSel.method`
- Amount input (editable, pre-filled with due amount)
- Pay button → `custPayNow(id)` (records payment, notifies office)
- "Save card" checkbox → saves card on file
- Paid state shows confirmation

---

## 6. Cross-Cutting Interactions

### 6.1 AI Command Bar (bottom strip)

Functions: `cmdFocus()`, `cmdClose()`, `cmdHide()`, `cmdShow()`, `cmdAsk(q)`, `cmdPhoto()`, `renderCmdMenu()`

States:
- **Collapsed**: visible strip with "Ask Mallet" prompt
- **Open**: text input + photo toggle + suggested prompts
- **Photo mode**: `state.cmdPhoto=true` — camera icon active, AI answers with field-photo context

Role-aware behavior:
- Tech (`role=tech` + on `ops-myday`): uses `fieldAiAnswer(topic, hasPhoto, job)` — job-in-context AI with repair guidance, pricing from pricebook
- Office/owner: uses `aiRoute(q)` — general CRM AI, dispatches to domain-specific answers

`aiRoute(q)` dispatches to:
- Quote-building help → fills composer
- Booking / routing questions → booking playbook answers
- Price lookups → pricebook results
- General → `aiAnswer(q)` (simulated)

Interactions:
| Element | Action |
|---|---|
| Strip click / input focus | `cmdFocus()` → expands |
| Outside click | `cmdClose()` |
| Hide bar | `cmdHide()` |
| Input Enter / Send | `cmdAsk(q)` |
| Camera toggle | `cmdPhoto()` |
| Plugin panel | `state.aiPlugOpen=!state.aiPlugOpen` |

### 6.2 Floating Call Bar

Rendered by `renderCallBar()` into `#callbar`.

Active call:
- Customer name + number
- Live timer (ticks every second via `setInterval`)
- Notes textarea → `state.activeCall.notes=v`
- "End call" → `endCall()` → outcome chips (Connected / Left voicemail / No answer / Busy / Wrong number) → `finishCall(outcome)` → logs to lead timeline, calls `firstTouch` if New customer

### 6.3 Notifications Drawer

| Element | Action |
|---|---|
| Bell icon | `openNotifs()` — slides in right-side panel |
| Notification row click | Navigates to relevant lead/invoice/quote |
| "Mark all read" | `notifMarkAll()` |
| Individual dismiss | `notifDismiss(id)` |

Notification domains: `quotes` (sent/viewed/accepted/declined), `money` (paid), `ops` (dispatch), `fd` (AI Front Desk events).

### 6.4 AI Front Desk (FD) system

State: `state.fd = {on, mode('miss'/'always'), drafts[]}`

Draft object: `{id, name, phone, job, source, slot, routedAs, status('pending'/'booked'/'declined'), origMsg}`

Functions:
| Function | What it does |
|---|---|
| `fdSim('missed'/'call')` | Simulates incoming call/text, runs `routeIntake()`, creates draft |
| `fdBook(draftId)` | Creates customer + job/visit from draft, texts "Confirmed ✓" |
| `fdDecline(draftId)` | Dismisses draft |
| `routeIntake(msg)` | Parses message against booking playbook → `{inScope, lane, service, hit, price}` |
| `intakeDemo(mode)` | Runs the live-demo intake simulation |

Home page draft card shows: parsed customer name, job, routed-as label, "Book it" → `fdBook()`, "Decline" → `fdDecline()`

### 6.5 Dark Mode Toggle

- Toggle button in header → `toggleDark()` — adds/removes `.dark` class on `<body>`, saves to `localStorage`

### 6.6 Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `→` | Tour active, not in input | `tourNext()` |
| `←` | Tour active, not in input | `tourBack()` |
| `h` / `H` | Tour active, not in input | Toggle tour narration bubble |
| `Escape` | Tour narration hidden | Shows narration bubble |

### 6.7 Drag-and-Drop

**Pipeline kanban:**
- `dragLead(ev, id)` on card `ondragstart` → sets `state.dragId`, adds `body.dragging` class
- `dragEnd()` on `ondragend` → removes `body.dragging`
- `dropLead(ev, stage)` on column `ondrop` → moves lead's stage; if dropped on "Won" → `approveQuote` + `createJobFromWin`
- `dropTrash(ev)` on trash zone → opens `ovClean` for `cleanId`

**Schedule board:**
- `visitDragStart(ev, id)` on job block → `state.jobDrag={kind:'visit', id}`
- `evisitDragStart(ev, id)` on estimate-visit block → `state.jobDrag={kind:'evisit', id}`
- `visitDropHour(ev, techId, iso, hour)` on hour cell → `placeVisitAt(id, techId, iso, hour)`
- `jobDrop(ev, techId, iso)` on day column → `placeVisitAt(id, techId, iso, null)` (first open hour)
- `blockResizeStart(ev, vId)` + `mousemove/mouseup` → `blockResizeMove/End()` — adjusts visit duration to nearest 15 min

### 6.8 Auto-behaviors (no user interaction)

| Trigger | Auto action |
|---|---|
| Lead dropped to Won stage | `createJobFromWin()` — creates job in ops |
| Quote accepted | Lead → Won; job created; deposit recorded if set |
| Quote sent | Lead auto-advances to "Quote Sent" if earlier |
| First call or text to New customer | Lead auto-advances to "Contacted" |
| Visit booked | Lead auto-advances via `autoStage(l, 'visit-booked', ...)` if Visit stage configured |
| Invoice sent | `fu.on=true, fu.stage=0` — auto-reminder scheduler armed |
| Custom-field used 3× | Field "promoted" — shown on all lead forms automatically |
| 2+ leads linked to same company | Companies nav item promoted to sidebar |
| Quote viewed by customer | `simView()` → moves to Quote Opened stage (if configured) |
| `state.autoRemind=true` | Reminder texts fire at +3d / +6d (simulated in `simDays`) |

### 6.9 Demo Tour System

Tours: `TOURS.job` (V1: new customer → paid, 14 steps) and `TOURS.estimate` (V2: AI Front Desk, 6 steps).

Tour coach bubble (`#tourCoach`):
- **Normal mode**: title, body, step counter, Back/Next/Exit/Min buttons
- **Mini mode** (`state.tourMin=true`): compact ← N/total → bar + expand button

Navigation:
- `tourNext()` / `tourBack()` → `tourStep(n)` → calls `step.nav()` (navigates real screens)
- `tourMinToggle()` — collapses/expands coach
- `tourExit()` — resets state, restores data snapshot if sample was loaded
- `tourHide()` — hides coach bubble (keyboard `h`)

Each V1 step's `nav()` runs actual app functions (open modals, change role, start timer, etc.).

### 6.10 Inline Edit Patterns

Used throughout (not requiring modals):
- Lead name: `<input class="lead-name">` with `onchange="saveLeadName(id, v)"`
- Lead phone: `<input class="lead-phone">` with `onchange="saveLeadField(id, 'phone', v)"`
- Job title, address, type: `onchange="jobSetField(id, k, v)"`
- Brief chips: click → `briefEditChip()` → replaces chip with inline input → Enter/blur → `briefSave()`
- Custom fields on lead detail: cfrow pattern with key select + value input → `addLeadCustomFromDetail(id)`
- Invoice edits (hand-made drafts): all fields inline in `invEditBlock()`

### 6.11 Toast Notifications

`toast(msg, green?, durationMs?)` — ephemeral bottom banner. Contains clickable links for:
- Undo actions (send, delete, charge)
- Navigation shortcuts ("Open the job →")
- Secondary actions ("Text a receipt", "see what they see")

Auto-dismisses after `durationMs` (default ~4s, important actions 12-15s).

---

## 7. Overlay IDs Reference

Complete list of `div.overlay` elements and their IDs:

| ID | Populated by | Open function |
|---|---|---|
| `ovQuick` | `#qaBody` | `openQuickAdd()` |
| `ovLead` | `#leadModalBody` | `openLead(id)` |
| `ovEst` | `#estModalBody` | `openEst(id)` |
| `ovCust` | `#custBody` | `openCust(id)`, `openCustInv(id)`, `openCustPreview()` |
| `ovSign` | `#signBody` | `openSignSheet(estId)` |
| `ovCall` | `#callSheetBody` | `openCallSheet(id)` |
| `ovThread` | `#threadBody` | `openThread(id)` |
| `ovJob` | `#jobBody` | `openJob(id)` |
| `ovEvisit` | `#evisitBody` | `openEvisit(leadId, visitId)` |
| `ovInv` | `#invBody` | `openInvoice(id)`, `openCloseOut(jobId)` |
| `ovTQ` | `#tqBody` | `openTechQuote(jobId)` |
| `ovVisit` | `#visitBody` | `openVisitSheet(leadId)` |
| `ovStage` | `#stageModalBody` | `openStageModal(step?)` |
| `ovChk` | (inline) | `openChk(id)` |
| `ovClean` | `#cleanBody` | `buildClean()` |
| `ovSweep` | `#sweepBody` | `openJobSweep()`, `openQuoteSweep()` |
| `ovForm` | `#galBody2` | `openPbImport()` |
| `ovTech` | (inline) | Admin team detail |

---

## 8. React Implementation Notes

### State management
- Global `state` maps cleanly to a Zustand or Jotai store
- DATA collections → Supabase tables (already defined in Drizzle schema)
- UI STATE → React component state / URL params / Zustand ephemeral store
- `openOv/closeOv` pattern → React modals controlled by `modalOpen` flags in store

### Navigation
- `go(v)` → React Router `navigate(v)` with a route map
- `setModule(m)` → set active module in store + navigate to default route
- Role guard → `<ProtectedRoute role={...}>` wrappers

### Modal system
- Each overlay → a `<Modal>` component rendered at root level
- `state._coUI`, `state._billDraft` etc. → component-local state or dedicated modal atoms

### Drag and drop
- Pipeline kanban → `@dnd-kit/core` or `react-beautiful-dnd`
- Schedule grid → `@dnd-kit` with custom sensors for hour-precision drop targets
- Block resize → pointer event listeners (same pattern as prototype)

### Canvas signature
- `openSignSheet` / `tqRender` signature pad → `<canvas>` with `useRef` + pointer events
- `tqSigInit()` pattern maps directly to a React effect

### Real-time / auto behaviors
- Follow-up reminder scheduling → Supabase cron + webhook
- Auto-stage moves → server-side trigger on `estimates.status` update
- Notifications → Supabase Realtime subscription

### Checklist / note feed components
- `noteFeedInner(E)` → `<NotesFeed items={E}>` shared component (appears in lead modal, job modal, tech field view)
- `jobNoteFeed(j, opts)` → `<JobNotesFeed job={j} options={opts}>`

### Payment flow (`coPayBlock`)
- Multi-step payment UI → local state machine: `step: 'method' | 'tap' | 'record' | 'done'`
- Tap to Pay → Stripe Terminal SDK integration point

### GBB (Good/Better/Best)
- `gbbFor(type, lines)` → utility function, keep as-is
- `renderCustGbb()` → `<CustomerGbbPage>` component with tier state + toggle state
- `gbbReviewBody(c)` → `<GbbReview composer={c}>` in composer view
