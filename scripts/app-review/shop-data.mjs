/**
 * scripts/app-review/shop-data.mjs
 *
 * The FIXTURE for the App Review demo shop — pure data, no I/O. `seed-app-review-org.mjs`
 * is the only reader; keeping the two apart means the shop's content can be edited without
 * touching a single SQL statement.
 *
 * Everything here is deliberately BELIEVABLE rather than obviously synthetic. An App Review
 * engineer reads the demo account as a sample of the product's quality, so there is no
 * "Test Customer 1", no lorem, no $0.00 rows and no placeholder addresses. The shop is a
 * small Central Oregon plumbing outfit; names, streets and services are the ones such a
 * shop actually has.
 *
 * TWO conventions the seeder depends on:
 *
 *   1. `slug` — every row carries one, and its id is derived from it (see uuidFor in the
 *      seeder). That is what makes re-running converge onto the SAME rows instead of
 *      minting a second shop. Never renumber or reuse a slug.
 *   2. Times are RELATIVE and resolved in SQL, not JS: a job says `{ dayOffset: 0,
 *      startHour: 8.5 }` and the seeder turns it into
 *      `date_trunc('day', now() at <org tz>) + interval`. Building timestamps in JS with a
 *      hard-coded UTC offset breaks twice a year; this cannot.
 *
 * Phone numbers are all in the +1 541 555-01xx block, which is reserved for fiction and
 * cannot be dialled. Email domains for CREW are `.test` (RFC 2606) so no seeded address can
 * ever receive real mail. The one exception is the OWNER login, which must be an address
 * Owen controls because it is the credential handed to Apple.
 */

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

/**
 * Unmistakable on purpose. Owen has to be able to spot this org in a shared dev/prod
 * database at a glance, and a reviewer seeing "Apple Review" in the top bar gets a useful
 * signal that they are in a demo workspace rather than someone's live books.
 */
export const ORG_NAME = "Apple Review — Ridgeline Plumbing";

/** The reviewer's login. See PASSWORD in the seeder for why this is not a secret. */
export const OWNER_EMAIL = "appreview@trymallet.com";

export const ORG_TIMEZONE = "America/Los_Angeles";

export const SETTINGS = {
  trade: "plumbing",
  markupBps: 3500,
  timezone: ORG_TIMEZONE,
  // THE 4.2 SWITCH. Without this the Measure surfaces and the "Scan a room" row are absent
  // from the whole app, and the native RoomPlan scanner — the reason this is not a web page
  // in a wrapper — is unreachable. See docs/app-review-notes.md.
  measurementEstimating: true,
  // Prices must be visible on the field surface: the reviewer signs in as the owner and
  // walks the tech's Quote tab, and a redacted money column reads as a broken screen.
  techSeesPrice: true,
  techTexts: true,
  // OFF, and it must stay off. Switching the AI front desk on provisions a real phone
  // number and answers real calls; a demo org has no business doing either.
  frontDesk: false,
  scopeOn: true,
  autoRemind: true,
  hours: {
    // JS getDay() order is used by crew_schedules; org_settings has named columns.
    mon: [7, 17],
    tue: [7, 17],
    wed: [7, 17],
    thu: [7, 17],
    fri: [7, 16],
    sat: [8, 14],
    sun: [0, 0], // 0/0 is the closed sentinel
  },
  areaCities: "Bend, Redmond, Sisters, Sunriver, Tumalo",
  areaRadiusMi: 35,
  serviceOriginAddress: "61535 S Highway 97, Bend, OR 97702",
  brand: {
    tagline: "Licensed plumbing service across Central Oregon",
    color: "#1F5F8B",
    initials: "RP",
    // No brandSite: inventing a domain that 404s is worse than showing none.
    site: null,
  },
  /**
   * The front desk is OFF, so nothing here is ever spoken to a caller. It exists so the Front
   * Desk tab reads as a configured shop rather than an empty form.
   *
   * SHAPE IS VALIDATED ON THE READ PATH, and getting it wrong is not a cosmetic mistake: this
   * blob is part of `settingsDTO`, so a row that fails `bookingCfgDTO` makes `v1.settings.get`
   * return 500 — which takes SettingsHydrator down with it, leaves `toggles` at their `false`
   * placeholders, and silently removes the Measure card and the "Scan a room" row from the whole
   * app. Two rules, both learned the hard way here:
   *   - `lane` is exactly one of "repair" | "estimate" | "flat". There is no "install".
   *   - `triggers` is a comma-separated STRING, not an array.
   * See modules/settings/api/settings-dto.ts (bookingServiceDTO).
   */
  booking: {
    services: [
      { name: "Drain clearing", lane: "repair", price: 289, triggers: "clogged drain, slow drain, backed up" },
      { name: "Water heater — no hot water", lane: "repair", price: 189, triggers: "no hot water, water heater leaking" },
      { name: "Water heater replacement", lane: "flat", price: 2450, triggers: "new water heater, replace water heater" },
      { name: "Toilet repair or replacement", lane: "repair", price: 189, triggers: "toilet running, toilet leaking" },
      { name: "Repipe estimate", lane: "estimate", triggers: "repipe, galvanized pipes, low water pressure whole house" },
      { name: "Backflow test", lane: "repair", price: 175, triggers: "backflow test, backflow certification" },
    ],
    notServices: "Septic tank pumping, well pump service, irrigation system repair",
    serviceFee: 89,
    feeCredited: true,
  },
};

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

/**
 * Three staff. The OWNER is the reviewer's login and is also field crew, because the
 * walkthrough sends the reviewer to My day — an agenda that is assignee-scoped, so an
 * owner who holds no visits has an empty one.
 */
export const CREW = [
  {
    slug: "user-owner",
    email: OWNER_EMAIL,
    name: "Dana Whitfield",
    role: "owner",
    isFieldCrew: true,
    skillTags: ["Backflow tester", "Gas line"],
  },
  {
    slug: "user-tech-marcus",
    email: "marcus.ruiz@ridgeline-review.mallet.test",
    name: "Marcus Ruiz",
    role: "tech",
    isFieldCrew: true,
    skillTags: ["Backflow tester"],
  },
  {
    slug: "user-tech-nina",
    email: "nina.alvarez@ridgeline-review.mallet.test",
    name: "Nina Alvarez",
    role: "tech",
    isFieldCrew: true,
    skillTags: ["Sewer camera"],
  },
];

export const LEAD_SOURCES = ["Google", "Referral", "Repeat customer", "Nextdoor", "Yelp"];

export const LABOR_RATES = [
  { slug: "labor-journeyman", label: "Journeyman plumber", centsPerHour: 14500, kind: "hourly" },
  { slug: "labor-apprentice", label: "Apprentice", centsPerHour: 8500, kind: "hourly" },
  { slug: "labor-afterhours", label: "After hours / weekend", centsPerHour: 21750, kind: "hourly" },
];

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** 17 customers across every pipeline stage, so no list and no board column is empty. */
export const CUSTOMERS = [
  { slug: "c01", name: "Alicia Brennan", phone: "+15415550118", email: "alicia.brennan@example.com", address: "1544 NW Fort Clatsop St, Bend, OR 97703", stage: "quote_sent", source: "Referral", valueCents: 1148000, notes: "1962 build, galvanized supply lines. Wants the repipe priced before she lists the house in spring." },
  { slug: "c02", name: "Dale Okafor", phone: "+15415550124", email: "dokafor@example.com", address: "20870 Rocky Mountain Ct, Bend, OR 97701", stage: "won", source: "Google", valueCents: 245000, notes: "Gate code 4417. Dog in the back yard — friendly." },
  { slug: "c03", name: "Marta Vidal", phone: "+15415550131", email: "marta.vidal@example.com", address: "355 SW Rimrock Way, Redmond, OR 97756", stage: "contacted", source: "Google", valueCents: 0, notes: "Kitchen sink draining slowly. Asked for a Thursday morning slot." },
  { slug: "c04", name: "Curtis Lindgren", phone: "+15415550142", email: "clindgren@example.com", address: "61251 Ridgewater Loop, Bend, OR 97702", stage: "won", source: "Repeat customer", valueCents: 372500, notes: "Third job for this address. Prefers a text before arrival, not a call." },
  { slug: "c05", name: "Priya Raghunathan", phone: "+15415550155", email: "priya.r@example.com", address: "2891 NW Nordic Ave, Bend, OR 97703", stage: "new", source: "Nextdoor", valueCents: 0, notes: null },
  { slug: "c06", name: "Hollis Trent", phone: "+15415550163", email: "hollis.trent@example.com", address: "17540 Mountain View Rd, Sisters, OR 97759", stage: "quote_sent", source: "Referral", valueCents: 624000, notes: "Converting to tankless. Propane, not natural gas — confirm venting." },
  { slug: "c07", name: "Georgia Mbeki", phone: "+15415550170", email: "gmbeki@example.com", address: "56815 Venture Ln, Sunriver, OR 97707", stage: "won", source: "Google", valueCents: 65000, notes: "Vacation rental. Lockbox on the side gate; office has the code." },
  { slug: "c08", name: "Ronan Kirkpatrick", phone: "+15415550186", email: "ronan.k@example.com", address: "1120 SE Wilson Ave, Bend, OR 97702", stage: "contacted", source: "Yelp", valueCents: 0, notes: "Hose bib split over the winter. Wants it done before he turns the irrigation on." },
  { slug: "c09", name: "Sylvia Duarte", phone: "+15415550194", email: "sduarte@example.com", address: "3475 NE Purcell Blvd, Bend, OR 97701", stage: "won", source: "Repeat customer", valueCents: 28900, notes: null },
  { slug: "c10", name: "Emmett Cho", phone: "+15415550207", email: "emmett.cho@example.com", address: "640 NW Greenwood Ave, Bend, OR 97701", stage: "lost", source: "Google", valueCents: 0, lossReason: "Price", notes: "Went with a cheaper bid on the sewer spot repair." },
  { slug: "c11", name: "Tabitha Naylor", phone: "+15415550215", email: "tnaylor@example.com", address: "2205 NW Awbrey Rd, Bend, OR 97703", stage: "new", source: "Referral", valueCents: 0, notes: null },
  { slug: "c12", name: "Wesley Amaro", phone: "+15415550223", email: "wamaro@example.com", address: "8420 11th St, Terrebonne, OR 97760", stage: "contacted", source: "Google", valueCents: 0, notes: "Pressure reads 92 psi at the hose bib — likely a failed PRV." },
  { slug: "c13", name: "Ingrid Solheim", phone: "+15415550238", email: "ingrid.solheim@example.com", address: "1901 SW Chandler Ave, Bend, OR 97702", stage: "won", source: "Repeat customer", valueCents: 32500, notes: null },
  { slug: "c14", name: "Desmond Fairley", phone: "+15415550246", email: "dfairley@example.com", address: "425 NE Bellevue Dr, Bend, OR 97701", stage: "quote_sent", source: "Nextdoor", valueCents: 189500, notes: "Two bathrooms, fixtures already purchased." },
  { slug: "c15", name: "Camille Ostrowski", phone: "+15415550254", email: "camille.o@example.com", address: "63040 Deschutes Market Rd, Bend, OR 97701", stage: "new", source: "Google", valueCents: 0, notes: null },
  { slug: "c16", name: "Julian Reyes-Whitcomb", phone: "+15415550267", email: "jreyesw@example.com", address: "1075 NW Newport Ave, Bend, OR 97703", stage: "won", source: "Referral", valueCents: 52000, notes: null },
  { slug: "c17", name: "Bethany Kroll", phone: "+15415550279", email: "bkroll@example.com", address: "1045 SW Emkay Dr Suite 200, Bend, OR 97702", stage: "contacted", source: "Referral", valueCents: 0, role: "Property manager", notes: "Manages 14 units in the Old Mill district. Wants one invoice per building, not per unit." },
];

// ---------------------------------------------------------------------------
// Pricebook
// ---------------------------------------------------------------------------

export const PRICEBOOK_CATEGORIES = [
  { slug: "cat-service", name: "Service & diagnostics", sortOrder: 1 },
  { slug: "cat-drains", name: "Drains & sewer", sortOrder: 2 },
  { slug: "cat-water-heaters", name: "Water heaters", sortOrder: 3 },
  { slug: "cat-repipe", name: "Repipe & remodel", sortOrder: 4 },
  { slug: "cat-fixtures", name: "Fixtures", sortOrder: 5 },
];

/**
 * 14 services. `measuredBy` is the column the measurement pricing engine reads, and the
 * whole point of the two rows that set it is that a room scan produces a number the price
 * can multiply. `walls_sqft` and `baseboard_lnft` are the two units a plumbing shop
 * genuinely bills by — wall opened for access, and hydronic baseboard run.
 * Allowed values (pricebook_items_measured_by_check): null | hour | walls_sqft |
 * ceiling_sqft | baseboard_lnft | crown_lnft | doors_count | windows_count | site_sqft |
 * site_lnft.
 */
export const PRICEBOOK_ITEMS = [
  { slug: "pb-service-call", cat: "cat-service", code: "SVC-100", label: "Service call & diagnostic", priceCents: 8900, costCents: 0, laborHours: 0.75, measuredBy: null, description: "First hour on site: locate the fault and quote the repair. Credited against the repair if you go ahead." },
  { slug: "pb-labor-hour", cat: "cat-service", code: "SVC-110", label: "Journeyman labor — additional hour", priceCents: 14500, costCents: 6200, laborHours: 1, measuredBy: "hour", description: "Billed in quarter hours after the first hour." },
  { slug: "pb-backflow", cat: "cat-service", code: "SVC-140", label: "Backflow assembly test & certification", priceCents: 17500, costCents: 2400, laborHours: 1, measuredBy: null, description: "Annual test, tags and the report filed with the water district." },

  { slug: "pb-drain-main", cat: "cat-drains", code: "DRN-200", label: "Drain clearing — main line", priceCents: 28900, costCents: 4800, laborHours: 1.5, measuredBy: null, description: "Cable the main from the cleanout, up to 100 ft." },
  { slug: "pb-camera", cat: "cat-drains", code: "DRN-210", label: "Sewer camera inspection", priceCents: 32500, costCents: 3600, laborHours: 1.5, measuredBy: null, description: "Recorded run of the lateral with locate and depth at any defect." },
  { slug: "pb-jetting", cat: "cat-drains", code: "DRN-230", label: "Hydro jetting — main line", priceCents: 65000, costCents: 12500, laborHours: 3, measuredBy: null, description: "Full-diameter clean for grease or root intrusion. Includes a follow-up camera pass." },
  { slug: "pb-spot-repair", cat: "cat-drains", code: "DRN-260", label: "Sewer spot repair — excavated", priceCents: 285000, costCents: 96000, laborHours: 10, measuredBy: null, description: "Single-joint repair to 6 ft depth, backfill and compaction. Surface restoration quoted separately." },

  { slug: "pb-wh-50", cat: "cat-water-heaters", code: "WH-300", label: "Water heater — 50 gal gas, installed", priceCents: 245000, costCents: 118000, laborHours: 4, measuredBy: null, warranty: "6-year tank, 1-year labor", description: "Haul-away, new flex connectors, expansion tank and pan included. Permit filed." },
  { slug: "pb-wh-tankless", cat: "cat-water-heaters", code: "WH-330", label: "Tankless water heater — conversion, installed", priceCents: 485000, costCents: 231000, laborHours: 9, measuredBy: null, warranty: "12-year heat exchanger, 1-year labor", description: "Includes gas line upsize, stainless venting and condensate. Permit and inspection filed." },
  { slug: "pb-wh-flush", cat: "cat-water-heaters", code: "WH-310", label: "Water heater flush & anode replacement", priceCents: 21500, costCents: 4200, laborHours: 1, measuredBy: null, description: "Annual service. Doubles tank life on Central Oregon water." },

  // The two measurement-priced rows — what a room scan feeds.
  { slug: "pb-wall-access", cat: "cat-repipe", code: "RPP-400", label: "Repipe wall access & patch — per sq ft", priceCents: 1400, costCents: 480, laborHours: 0.1, measuredBy: "walls_sqft", description: "Open, repipe behind and patch to paint-ready, priced on the wall area actually opened. Measured from the room scan." },
  { slug: "pb-baseboard", cat: "cat-repipe", code: "RPP-430", label: "Hydronic baseboard line replacement — per ln ft", priceCents: 3800, costCents: 1350, laborHours: 0.2, measuredBy: "baseboard_lnft", description: "PEX-AL-PEX run behind existing baseboard, priced by the run length from the room scan." },
  { slug: "pb-prv", cat: "cat-repipe", code: "RPP-410", label: "Pressure-reducing valve replacement", priceCents: 52000, costCents: 16800, laborHours: 2.5, measuredBy: null, description: "New PRV at the main, set to 60 psi, with a thermal expansion check." },

  { slug: "pb-toilet", cat: "cat-fixtures", code: "FIX-500", label: "Toilet replacement — labor only", priceCents: 31000, costCents: 5200, laborHours: 2, measuredBy: null, description: "Set a customer-supplied fixture on a new flange seal and supply. Old unit hauled away." },
  { slug: "pb-faucet", cat: "cat-fixtures", code: "FIX-520", label: "Kitchen faucet replacement — labor only", priceCents: 26500, costCents: 4100, laborHours: 1.5, measuredBy: null, description: "Set a customer-supplied faucet with new stops and braided supplies." },
  { slug: "pb-hose-bib", cat: "cat-fixtures", code: "FIX-560", label: "Frost-free hose bib replacement", priceCents: 18500, costCents: 4800, laborHours: 1.25, measuredBy: null, description: "Cut in a new frost-free bib with a quarter-turn shutoff inside." },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Eight jobs spanning every state the product has a screen for. `dayOffset` is days from
 * today and `startHour` is a decimal hour in the ORG's timezone; the seeder resolves both
 * in SQL (see the module note).
 *
 * JOB-1001 IS THE REVIEWER'S JOB and every field of it is load-bearing:
 *   - `assignee: "user-owner"` — My day is assignee-scoped; on anyone else's job the
 *     reviewer's agenda is empty.
 *   - `dayOffset: 0` and status `scheduled` — myDay returns only scheduled + in-progress
 *     work, and the card must be the first one on the agenda.
 *   - `kind: "estimate"` with NO priced lines — that is what keeps the Quote tab's Scope
 *     section (which carries the "Scan a room" row) the whole tab, instead of the price
 *     builder taking over. See components/modals/tech-job-modal/quote-tab.tsx.
 *   - status must NOT be complete — the tab goes read-only on a closed job and the scan
 *     row disappears with the rest of the writes.
 */
export const JOBS = [
  {
    slug: "job-1001",
    num: "JOB-1001",
    customer: "c01",
    title: "Estimate — whole-house repipe",
    svc: "Repipe estimate",
    kind: "estimate",
    status: "scheduled",
    assignee: "user-owner",
    dayOffset: 0,
    startHour: 8.5,
    durationMinutes: 60,
    addr: "1544 NW Fort Clatsop St, Bend, OR 97703",
    notes: "Galvanized throughout, 1962 build. Measure the bathroom and kitchen walls for access — she wants the patch priced separately from the pipe.",
    scope: "Low pressure at every fixture upstairs. Wants copper-to-PEX priced two ways: minimum access, and open-and-patch to paint-ready.",
    lines: [],
  },
  {
    slug: "job-1002",
    num: "JOB-1002",
    customer: "c02",
    title: "Water heater replacement — 50 gal gas",
    svc: "Water heater replacement",
    kind: "work",
    status: "scheduled",
    assignee: "user-owner",
    dayOffset: 0,
    startHour: 10.5,
    durationMinutes: 240,
    addr: "20870 Rocky Mountain Ct, Bend, OR 97701",
    notes: "Gate code 4417. Existing unit is a 2009 40 gal — upsizing to 50. Permit already filed.",
    lines: [
      { item: "pb-wh-50", qty: 1 },
    ],
  },
  {
    slug: "job-1003",
    num: "JOB-1003",
    customer: "c09",
    title: "Main line drain clearing",
    svc: "Drain clearing",
    kind: "work",
    status: "scheduled",
    assignee: "user-tech-marcus",
    dayOffset: 0,
    startHour: 13.5,
    durationMinutes: 90,
    addr: "3475 NE Purcell Blvd, Bend, OR 97701",
    notes: "Third backup this year. Camera the line after cabling — likely roots at the property line.",
    lines: [{ item: "pb-drain-main", qty: 1 }],
  },
  {
    slug: "job-1004",
    num: "JOB-1004",
    customer: "c07",
    title: "Sewer camera inspection",
    svc: "Sewer camera inspection",
    kind: "work",
    status: "in_progress",
    assignee: "user-tech-nina",
    dayOffset: 0,
    startHour: 7.5,
    durationMinutes: 90,
    addr: "56815 Venture Ln, Sunriver, OR 97707",
    notes: "Vacation rental, lockbox on the side gate. Guest reported a smell in the downstairs bath.",
    lines: [{ item: "pb-camera", qty: 1 }],
  },
  {
    // The unscheduled one — a visit with no date and no assignee is what the Schedule
    // board's unplaced column exists to show.
    slug: "job-1005",
    num: "JOB-1005",
    customer: "c03",
    title: "Kitchen faucet replacement",
    svc: "Fixture replacement",
    kind: "work",
    status: "scheduled",
    assignee: null,
    dayOffset: null,
    startHour: null,
    durationMinutes: 90,
    addr: "355 SW Rimrock Way, Redmond, OR 97756",
    notes: "Customer has the faucet already. Waiting on her to confirm a Thursday morning.",
    lines: [{ item: "pb-faucet", qty: 1 }],
  },
  {
    // Done and invoiced, paid in full.
    slug: "job-1006",
    num: "JOB-1006",
    customer: "c04",
    title: "Tankless water heater conversion",
    svc: "Water heater replacement",
    kind: "work",
    status: "complete",
    assignee: "user-tech-marcus",
    dayOffset: -5,
    startHour: 7.5,
    durationMinutes: 480,
    addr: "61251 Ridgewater Loop, Bend, OR 97702",
    notes: "Gas line upsized to 3/4. Inspection passed same day.",
    completion: "Removed the 2011 50 gal tank, upsized the gas line to 3/4 inch, set and vented a condensing tankless unit, installed the condensate neutralizer and flushed the loop. Set outlet to 120F. Inspection passed.",
    fromQuote: "est-1003",
    lines: [
      { item: "pb-wh-tankless", qty: 1 },
      { item: "pb-labor-hour", qty: 2 },
    ],
  },
  {
    // Done and invoiced, still owed — the Money screen's receivable.
    slug: "job-1007",
    num: "JOB-1007",
    customer: "c13",
    title: "Water heater flush & anode",
    svc: "Water heater service",
    kind: "work",
    status: "complete",
    assignee: "user-tech-nina",
    dayOffset: -12,
    startHour: 9,
    durationMinutes: 75,
    addr: "1901 SW Chandler Ave, Bend, OR 97702",
    notes: null,
    completion: "Flushed roughly two gallons of sediment, replaced the anode rod and reset the thermostat to 120F. Tank is sound.",
    lines: [{ item: "pb-wh-flush", qty: 1 }, { item: "pb-service-call", qty: 1 }],
  },
  {
    // Done and NOT invoiced — the ready-to-bill worklist that Money's top half is for.
    slug: "job-1008",
    num: "JOB-1008",
    customer: "c16",
    title: "Frost-free hose bib — two replaced",
    svc: "Fixture replacement",
    kind: "work",
    status: "complete",
    assignee: "user-tech-marcus",
    dayOffset: -3,
    startHour: 13,
    durationMinutes: 150,
    addr: "1075 NW Newport Ave, Bend, OR 97703",
    notes: "Both bibs split over the winter.",
    completion: "Cut in two frost-free bibs, front and side, each with a quarter-turn shutoff inside the crawl space. Pressure tested at 60 psi, no weep.",
    lines: [{ item: "pb-hose-bib", qty: 2 }],
  },
];

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** Four quotes: two out for signature, one won (it became JOB-1006), one still a draft. */
export const QUOTES = [
  {
    slug: "est-1001",
    num: "EST-1001",
    customer: "c01",
    title: "Whole-house repipe — copper to PEX",
    status: "sent",
    sentDaysAgo: 3,
    validDays: 30,
    taxBps: 0,
    lines: [
      { description: "Repipe 2 bath / 1 kitchen — PEX-A manifold system, 14 fixture drops", qty: 1, rateCents: 745000, costCents: 268000 },
      { item: "pb-wall-access", qty: 186, note: "Wall area opened for access" },
      { item: "pb-prv", qty: 1 },
      { description: "Permit and inspection", qty: 1, rateCents: 38000, costCents: 38000 },
    ],
  },
  {
    slug: "est-1002",
    num: "EST-1002",
    customer: "c06",
    title: "Tankless conversion — propane",
    status: "sent",
    sentDaysAgo: 6,
    validDays: 30,
    taxBps: 0,
    lines: [
      { item: "pb-wh-tankless", qty: 1 },
      { description: "Propane regulator and line upsize to 3/4 inch", qty: 1, rateCents: 118000, costCents: 46000 },
      { item: "pb-labor-hour", qty: 4 },
    ],
  },
  {
    slug: "est-1003",
    num: "EST-1003",
    customer: "c04",
    title: "Tankless water heater conversion",
    status: "accepted",
    sentDaysAgo: 14,
    acceptedDaysAgo: 9,
    validDays: 30,
    taxBps: 0,
    lines: [
      { item: "pb-wh-tankless", qty: 1 },
      { item: "pb-labor-hour", qty: 2 },
    ],
  },
  {
    slug: "est-1004",
    num: "EST-1004",
    customer: "c14",
    title: "Two-bath fixture package — labor",
    status: "draft",
    validDays: 30,
    taxBps: 0,
    lines: [
      { item: "pb-toilet", qty: 2 },
      { item: "pb-faucet", qty: 2 },
      { item: "pb-service-call", qty: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Two invoices, both raised from a finished job so their lines are the job's lines. One
 * paid in full, one still inside terms — the two states the Money ledger is built to
 * separate. JOB-1008 is deliberately left unbilled.
 */
export const INVOICES = [
  { slug: "inv-1001", num: "INV-1001", job: "job-1006", status: "paid", termsDays: 7, sentDaysAgo: 5, paidInFull: true },
  { slug: "inv-1002", num: "INV-1002", job: "job-1007", status: "sent", termsDays: 14, sentDaysAgo: 11, paidInFull: false },
];

/**
 * Where the seeder starts the org's own numbering. Above every hand-written num above, so
 * the first job/quote/invoice a reviewer creates gets a fresh number instead of colliding
 * with a seeded one.
 */
export const SEQUENCE_START = 1100;
