/**
 * lib/prototype-sample.ts
 *
 * Typed constants ported VERBATIM from the prototype's `let state = {` block
 * (elas-crm-prototype.html lines 1205-1403).  Field names, values, and IDs are
 * kept exactly as the prototype has them so every screen renders identically.
 *
 * TODAY is pinned to 2026-07-01 (the date the port was authored) so age/date
 * comparisons yield the same results as the prototype's todayISO() helper.
 */

import { clampSharePct } from "@mallet/shared/types";

// ---------- date helpers (mirrors the prototype) ----------
export const TODAY_ISO = "2026-07-01";

/** Returns ISO date string N days from TODAY_ISO */
export function dPlus(n: number): string {
  const d = new Date(TODAY_ISO + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- type shapes ----------

export interface SampleLead {
  id: string;
  name: string;
  phone: string;
  source: string;
  stage: string;
  age: number;
  job: string;
  last: string;
  book?: boolean;
  unread?: boolean;
  estId?: string;
  email?: string;
  address?: string;
  companyId?: number;
  role?: string;
  value?: number;
  lossReason?: string;
  acts?: SampleAct[];
  card?: { brand: string; last4: string; via: string };
}

export interface SampleVisit {
  id: string;
  date: string;
  techId: string;
  start: number;
  dur: number;
  status: string;
  onsiteAt?: string;
  scopeNotes?: string;
  photos?: string[];
}

export interface SampleAct {
  type: string;
  overnight?: boolean;
  dir?: string;
  outcome?: string;
  dur?: string;
  via?: string;
  when: string;
  notes?: string;
  from?: string;
  t?: string;
}

export interface SampleEstimateLine {
  d: string;
  q: number;
  r: number;
  photo?: boolean;
  opt?: boolean;
  /** This line is NOT taxable. The exception, absent on an ordinary line — see the same key on
   *  the store's EstimateLine. */
  notax?: boolean;
  c?: number;
  h?: number;
  tune?: boolean;
}

export interface SampleEstimate {
  id: string;
  num: string;
  leadId: string;
  title: string;
  status: string;
  age: number;
  viewed: boolean;
  validDays?: number;
  fu: { on: boolean; stage: number };
  lines: SampleEstimateLine[];
  pricing?: { disc: number; dep: number; tax: number };
  /** Customer opens of the quote page (oldest → newest). */
  reads?: { when: string; daysAgo: number; live?: boolean; device?: number }[];
}

export interface SampleJobLine {
  d: string;
  q: number;
  r: number;
  c?: number;
}

export interface SampleJob {
  id: string;
  leadId: string;
  svc: string;
  origin: string;
  title: string;
  addr: string;
  phone: string;
  status: string;
  archived: boolean;
  lines: SampleJobLine[];
  addons: unknown[];
  photos: string[];
  notes: string;
  special?: string;
  acts: unknown[];
  visits: SampleVisit[];
}

export interface SampleInvoiceLine {
  d: string;
  q: number;
  r: number;
}

export interface SamplePayment {
  amt: number;
  when: string;
  method: string;
}

export interface SampleInvoice {
  id: string;
  num: string;
  jobId: string | null;
  leadId: string;
  cust: string;
  phone: string;
  title: string;
  lines: SampleInvoiceLine[];
  total: number;
  depPaid: number;
  payments: SamplePayment[];
  status: string;
  age: number;
  fu?: { on: boolean; stage: number };
  archived: boolean;
}


export interface SampleTech {
  id: string;
  name: string;
  initials: string;
  color: string;
  skills: string[];
  wage: number;
  sells?: boolean;
}

export interface SampleBrand {
  site: string;
  name: string;
  initials: string;
  color: string;
  tagline: string;
}

// ---------- sample data ----------

export const SAMPLE_LEADS: SampleLead[] = [
  {
    id: "1",
    name: "Janet Kim",
    phone: "(925) 555-0142",
    source: "Google",
    stage: "New customer",
    age: 0,
    job: "Water heater making banging noise",
    last: "Came in via website form today",
  },
  {
    id: "2",
    name: "Tom Brennan",
    phone: "(925) 555-0177",
    source: "Nextdoor / FB",
    stage: "New customer",
    age: 4,
    job: "Possible slab leak — wet spot in hallway",
    last: "No contact yet",
  },
  {
    id: "3",
    name: "Rob Alvarez",
    phone: "(510) 555-0199",
    source: "Referral",
    stage: "Contacted",
    age: 2,
    job: "Whole-house repipe, 1962 build",
    last: "Site visit done — 11a today, Mike walked it",
    address: "88 Touriga Dr, Pleasanton",
    // Mike walked it this morning — scoped, no quote yet: the estimate run's
    // headline case (priced from these notes + the shop's last repipe).
    acts: [
      {
        type: "call",
        dir: "out",
        outcome: "Connected",
        dur: "12m",
        via: "logged",
        when: "Tue 2:10pm",
        notes: "Wants a ballpark number before committing to a site visit. 1962 galvanized.",
      },
    ],
  },
  {
    id: "4",
    name: "Hector Ruiz",
    phone: "(925) 555-0118",
    source: "Yard sign",
    stage: "Contacted",
    age: 1,
    job: "Two toilets replaced",
    last: "Texted photos of bathrooms yesterday",
    unread: true,
    acts: [
      {
        type: "call",
        dir: "in",
        outcome: "Connected",
        dur: "4m",
        via: "elas",
        when: "Mon 9:32am",
        notes: "Saw the yard sign on Vineyard Ave. Two toilets, wants Toto.",
      },
      { type: "text", from: "us", t: "Hi Hector, great talking just now — can you text me a photo of each bathroom so I can quote it right?", when: "Mon 9:41am" },
      { type: "text", from: "them", t: "Will do later today ", when: "Mon 11:05am" },
      { type: "text", from: "them", t: "Just sent both pics — the hallway one runs constantly btw", when: "Yesterday 6:12pm" },
    ],
  },
  {
    id: "5",
    name: "Sandy Whitfield",
    phone: "(925) 555-0163",
    source: "Repeat customer",
    stage: "Quote Sent",
    age: 9,
    job: "Kitchen drain + install cleanout",
    last: "Quote sent 4 days ago",
    estId: "est-101",
    email: "sandy.whit@gmail.com",
    address: "218 Kottinger Dr, Pleasanton",
    acts: [
      { type: "text", from: "us", t: "Hi Sandy — quote for the kitchen drain + cleanout is on its way. Any questions, just text me here.", when: "4 days ago" },
      { type: "text", from: "auto", t: "Your quote Q-1042 from Rivera Plumbing is ready — view and approve: rivera.mallet.ai/q/1042", when: "4 days ago" },
      { type: "text", from: "auto", t: "Friendly reminder from Rivera Plumbing — your quote Q-1042 is waiting whenever you are ready: rivera.mallet.ai/q/1042", when: "Yesterday" },
    ],
  },
  {
    id: "6",
    name: "Maria Lopez",
    phone: "(415) 555-0151",
    source: "Google",
    stage: "Quote Sent",
    age: 5,
    job: "40-gal water heater replacement",
    last: "Opened the quote at 9:12pm",
    estId: "est-102",
    email: "mlopez415@gmail.com",
    acts: [
      { type: "ai", from: "auto", overnight: true, when: "9:12pm", t: "Maria opened quote Q-1043 — second look this week." },
    ],
  },
  {
    id: "7",
    name: "Dave Chen",
    phone: "(925) 555-0133",
    source: "Referral",
    stage: "Won",
    age: 14,
    job: "Repipe — accepted",
    last: "Won Jun 2",
    value: 7200,
    email: "dchen@gmail.com",
    address: "4467 Black Ave, Pleasanton",
    card: { brand: "Visa", last4: "4242", via: "the deposit" },
  },
  {
    id: "8",
    name: "Linda Park",
    phone: "(925) 555-0166",
    source: "Google",
    stage: "Won",
    age: 10,
    job: "Water heater — accepted",
    last: "Won May 30",
    value: 2150,
    email: "lpark88@yahoo.com",
  },
  {
    id: "9",
    name: "Gary Wolfe",
    phone: "(925) 555-0810",
    source: "Nextdoor / FB",
    stage: "Lost",
    age: 12,
    job: "Toilet install",
    last: "Went with cheaper bid",
    lossReason: "Price",
  },
  {
    id: "10",
    name: "Diane Foster",
    phone: "(925) 555-0190",
    source: "Referral",
    stage: "Contacted",
    age: 1,
    job: "Unit 4B water heater — 4012 Foothill Rd",
    last: "Walkthrough scheduled",
    companyId: 1,
    role: "Property manager",
    email: "diane@crestviewpm.com",
    address: "4012 Foothill Rd, Pleasanton",
    // Walkthrough on the books — the estimate run holds her until it happens.
  },
  // book:true = customer-book records (direct-booked work)
  {
    id: "11",
    name: "Sofia Hernandez",
    phone: "(925) 555-0150",
    source: "Repeat customer",
    stage: "Won",
    book: true,
    age: 3,
    job: "Two toilets replaced",
    last: "Booked direct — two toilets",
    address: "318 Sycamore Rd, Pleasanton",
    card: { brand: "Visa", last4: "4242", via: "her $500 payment" },
  },
  {
    id: "12",
    name: "Rita Okafor",
    phone: "(925) 555-0161",
    source: "Google",
    stage: "Won",
    book: true,
    age: 1,
    job: "AC seasonal tune-up",
    last: "Booked direct — AC tune-up",
    address: "90 Vineyard Ave, Pleasanton",
  },
  {
    id: "13",
    name: "Tom Webb",
    phone: "(925) 555-0172",
    source: "Yard sign",
    stage: "Won",
    book: true,
    age: 2,
    job: "Sewer camera + jet",
    last: "Booked direct — drain camera",
    address: "12 Stanley Blvd, Pleasanton",
  },
  {
    id: "14",
    name: "Lan Nguyen",
    phone: "(925) 555-0179",
    source: "Repeat customer",
    stage: "Won",
    book: true,
    age: 0,
    job: "Kitchen faucet install",
    last: "Booked direct — faucet",
    address: "77 Main St, Pleasanton",
  },
  {
    // Caught & BOOKED by the AI Front Desk after close — the home Handoff's
    // headline receipt. Transcript lives in the acts (open the thread to read it).
    id: "15",
    name: "Denise Wagner",
    phone: "(925) 555-0148",
    source: "AI Front Desk",
    stage: "Won",
    book: true,
    age: 0,
    job: "Garbage disposal replacement",
    last: "Booked by the Front Desk — Thu 8:00 AM",
    address: "1420 Vineyard Ave, Pleasanton",
    acts: [
      { type: "call", dir: "in", overnight: true, from: "auto", when: "8:47pm", dur: "3m", outcome: "Answered by Front Desk", t: "Missed-hours call answered. Disposal is jammed and leaking underneath — wants it swapped this week. Offered Thursday 8:00 AM, she took it.", notes: "Unit is a 12-year-old Badger; under-sink leak started yesterday." },
      { type: "text", from: "auto", overnight: true, when: "8:51pm", t: "Hi Denise — Rivera Plumbing. You're booked for Thu 8:00 AM: garbage disposal replacement at 1420 Vineyard Ave. Reply here if anything changes." },
      { type: "text", from: "them", overnight: true, when: "8:53pm", t: "Perfect, thank you! Gate code is 2214." },
    ],
  },
  {
    // Second overnight caller — message taken + booking link texted; not booked yet.
    id: "16",
    name: "Gary Simmons",
    phone: "(925) 555-0121",
    source: "AI Front Desk",
    stage: "New customer",
    age: 0,
    job: "Leaky hose bib on the side of the house",
    last: "Front Desk took the details · texted him the booking link",
    acts: [
      { type: "call", dir: "in", overnight: true, from: "auto", when: "9:38pm", dur: "2m", outcome: "Answered by Front Desk", t: "Evening call answered. Hose bib on the side of the house drips constantly — not urgent. Took his details and texted the booking link." },
      { type: "text", from: "auto", overnight: true, when: "9:41pm", t: "Hi Gary — Rivera Plumbing. Grab a time that suits and we'll get that hose bib sorted: rivera.mallet.ai/book" },
    ],
  },
  {
    // Work finished yesterday, never invoiced — the "done, not billed" leak.
    // book:true keeps her off the Pipeline board; her money surfaces only on Jobs.
    id: "17",
    name: "Priya Shah",
    phone: "(925) 555-0184",
    source: "Referral",
    stage: "Won",
    book: true,
    age: 1,
    job: "Hose bib rebuild",
    last: "Work done yesterday — Tasha",
    address: "51 Kolln St, Pleasanton",
    email: "priya.shah@gmail.com",
  },
];


export const SAMPLE_ESTIMATES: SampleEstimate[] = [
  {
    id: "est-101",
    num: "Q-1042",
    leadId: "5",
    title: "Kitchen drain + cleanout",
    status: "sent",
    age: 4,
    viewed: true,
    validDays: 14,
    fu: { on: true, stage: 1 },
    // One read the day it landed, then silence — the cooling row.
    reads: [{ when: "Fri", daysAgo: 3 }],
    lines: [
      { d: "Hydro-jet kitchen drain line", q: 1, r: 450 },
      { d: "Install exterior cleanout", q: 1, r: 780, photo: true },
      { d: "Camera verification after clear", q: 1, r: 220 },
      { d: "Enzyme drain treatment — 12-month protection", q: 1, r: 189, opt: true },
    ],
  },
  {
    id: "est-102",
    num: "Q-1043",
    leadId: "6",
    title: "40-gal gas water heater replacement",
    status: "sent",
    age: 1,
    viewed: true,
    fu: { on: true, stage: 0 },
    // Two reads — the second at 9:12pm matches her overnight act on the lead.
    reads: [
      { when: "6:05pm", daysAgo: 1 },
      { when: "9:12pm", daysAgo: 0 },
    ],
    pricing: { disc: 0, dep: 30, tax: 0 },
    lines: [
      { d: "Remove & haul away existing unit", q: 1, r: 150 },
      { d: "40-gal gas water heater (Rheem Performance)", q: 1, r: 1650 },
      { d: "Expansion tank + seismic straps (code)", q: 1, r: 385 },
      { d: "Labor — install, test, startup", q: 3.5, r: 170 },
      { d: "City permit", q: 1, r: 110 },
    ],
  },
  {
    id: "est-103",
    num: "Q-1044",
    leadId: "4",
    title: "Two toilet replacements",
    status: "draft",
    age: 0,
    viewed: false,
    fu: { on: true, stage: 0 },
    lines: [{ d: "Toilet — Toto Drake, supplied & installed", q: 2, r: 460 }],
  },
  {
    id: "est-104",
    num: "Q-1039",
    leadId: "7",
    title: "Whole-house PEX repipe",
    status: "accepted",
    age: 14,
    viewed: true,
    fu: { on: true, stage: 1 },
    lines: [
      { d: "Whole-house PEX repipe — 3 bed / 2 bath", q: 1, r: 6400 },
      { d: "Drywall patch allowance", q: 1, r: 500 },
      { d: "Permit + inspection", q: 1, r: 300 },
    ],
  },
  {
    id: "est-105",
    num: "Q-1037",
    leadId: "8",
    title: "Water heater replacement",
    status: "accepted",
    age: 10,
    viewed: true,
    fu: { on: true, stage: 0 },
    lines: [{ d: "40-gal gas water heater installed", q: 1, r: 2150 }],
  },
];

export const SAMPLE_JOBS: SampleJob[] = [
  {
    id: "901",
    leadId: "7",
    svc: "install",
    origin: "accepted",
    title: "Whole-house PEX repipe",
    addr: "4467 Black Ave, Pleasanton",
    phone: "(925) 555-0133",
    status: "scheduled",
    archived: false,
    lines: [
      { d: "Whole-house PEX repipe — 3 bed / 2 bath", q: 1, r: 6400, c: 2300 },
      { d: "Drywall patch & paint allowance", q: 1, r: 500, c: 120 },
      { d: "Permit + inspection", q: 1, r: 300, c: 0 },
    ],
    addons: [],
    photos: ["scope-1", "scope-2", "scope-3"],
    notes: "1962 build, access via garage. 2-day job — rough today, finish Thursday.",
    special:
      "Homeowner works nights — no start before 9am. Two indoor cats: keep the side gate shut. Leave the old copper for their scrap guy.",
    acts: [],
    visits: [
      { id: "9011", date: TODAY_ISO, techId: "2", start: 9, dur: 4, status: "onsite", onsiteAt: "9:04" },
      { id: "9012", date: dPlus(2), techId: "2", start: 9, dur: 3, status: "scheduled" },
    ],
  },
  {
    id: "902",
    leadId: "8",
    svc: "install",
    origin: "accepted",
    title: "Water heater replacement",
    addr: "",
    phone: "(925) 555-0166",
    status: "unscheduled",
    archived: false,
    lines: [{ d: "40-gal water heater install", q: 1, r: 2150, c: 780 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
  },
  {
    id: "903",
    leadId: "11",
    svc: "install",
    origin: "booked",
    title: "Two toilets — Hernandez",
    addr: "318 Sycamore Rd, Pleasanton",
    phone: "(925) 555-0150",
    status: "scheduled",
    archived: false,
    lines: [{ d: "Toilet R&R", q: 2, r: 460, c: 150 }],
    addons: [],
    photos: [],
    notes: "Gate code 4412.",
    acts: [],
    visits: [{ id: "9031", date: TODAY_ISO, techId: "1", start: 13, dur: 2, status: "scheduled" }],
  },
  {
    id: "904",
    leadId: "12",
    svc: "service",
    origin: "booked",
    title: "AC tune-up — Okafor",
    addr: "90 Vineyard Ave, Pleasanton",
    phone: "(925) 555-0161",
    status: "scheduled",
    archived: false,
    lines: [{ d: "AC seasonal tune-up", q: 1, r: 189, c: 20 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [{ id: "9041", date: dPlus(1), techId: "3", start: 10, dur: 1.5, status: "scheduled" }],
  },
  {
    id: "905",
    leadId: "13",
    svc: "service",
    origin: "booked",
    title: "Drain camera — Webb",
    addr: "12 Stanley Blvd, Pleasanton",
    phone: "(925) 555-0172",
    status: "scheduled",
    archived: false,
    lines: [{ d: "Sewer camera + jet", q: 1, r: 640, c: 90 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [{ id: "9051", date: dPlus(2), techId: "2", start: 13, dur: 2, status: "scheduled" }],
  },
  {
    id: "906",
    leadId: "14",
    svc: "install",
    origin: "accepted",
    title: "Faucet install — Nguyen",
    addr: "77 Main St, Pleasanton",
    phone: "(925) 555-0179",
    status: "unscheduled",
    archived: false,
    lines: [{ d: "Kitchen faucet supplied & installed", q: 1, r: 340, c: 140 }],
    addons: [],
    photos: [],
    notes: "Customer supplying the faucet.",
    acts: [],
    visits: [],
  },
  {
    // Booked overnight by the AI Front Desk (Denise Wagner) — Thu 8:00 AM.
    id: "907",
    leadId: "15",
    svc: "service",
    origin: "frontdesk",
    title: "Garbage disposal replacement — Wagner",
    addr: "1420 Vineyard Ave, Pleasanton",
    phone: "(925) 555-0148",
    status: "scheduled",
    archived: false,
    lines: [{ d: "Garbage disposal — supplied & installed (1/2 HP)", q: 1, r: 980, c: 420 }],
    addons: [],
    photos: [],
    notes: "Gate code 2214. Under-sink leak — bring a pan liner.",
    acts: [],
    visits: [{ id: "9071", date: dPlus(2), techId: "2", start: 8, dur: 1.5, status: "scheduled" }],
  },
  {
    // Finished yesterday by Tasha, no invoice raised → "Done, not billed" on Jobs.
    id: "908",
    leadId: "17",
    svc: "service",
    origin: "accepted",
    title: "Hose bib rebuild — Shah",
    addr: "51 Kolln St, Pleasanton",
    phone: "(925) 555-0184",
    status: "done",
    archived: false,
    lines: [{ d: "Frost-free hose bib — supplied & rebuilt", q: 1, r: 480, c: 165 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [{ id: "9081", date: dPlus(-1), techId: "3", start: 14, dur: 1, status: "done" }],
  },
];

export const SAMPLE_INVOICES: SampleInvoice[] = [
  {
    id: "inv-801",
    num: "INV-2041",
    jobId: null,
    leadId: "12",
    cust: "Rita Okafor",
    phone: "(925) 555-0161",
    title: "AC seasonal tune-up",
    lines: [{ d: "AC seasonal tune-up", q: 1, r: 189 }],
    total: 189,
    depPaid: 0,
    payments: [{ amt: 189, when: "May 28", method: "card" }],
    status: "paid",
    age: 6,
    archived: false,
  },
  {
    id: "inv-802",
    num: "INV-2042",
    jobId: null,
    leadId: "13",
    cust: "Tom Webb",
    phone: "(925) 555-0172",
    title: "Sewer camera + jet (April call-out)",
    lines: [{ d: "Sewer camera + hydro-jet", q: 1, r: 640 }],
    total: 640,
    depPaid: 0,
    payments: [],
    status: "sent",
    age: 9,
    fu: { on: true, stage: 2 },
    archived: false,
  },
  {
    id: "inv-803",
    num: "INV-2043",
    jobId: null,
    leadId: "11",
    cust: "Sofia Hernandez",
    phone: "(925) 555-0150",
    title: "Shut-off valve replacements",
    lines: [{ d: "Replace 3 corroded shut-off valves", q: 1, r: 920 }],
    total: 920,
    depPaid: 0,
    payments: [{ amt: 500, when: "Yesterday", method: "card" }],
    status: "partial",
    age: 1,
    archived: false,
  },
];

export const SAMPLE_TECHS: SampleTech[] = [
  { id: "1", name: "Mike Rivera", initials: "MR", color: "#9C5B34", skills: ["Master Plumber", "Gas", "Backflow"], wage: 55, sells: true },
  { id: "2", name: "Carlos Diaz", initials: "CD", color: "#1d4ed8", skills: ["Journeyman Plumber", "Drain / sewer"], wage: 42 },
  { id: "3", name: "Tasha Bell", initials: "TB", color: "#b45309", skills: ["EPA 608 (HVAC)", "Electrical"], wage: 48 },
];

export const SAMPLE_BRAND: SampleBrand = {
  site: "riveraplumbing.com",
  name: "Rivera Plumbing",
  initials: "RP",
  color: "#9C5B34",
  tagline: "Licensed & insured · Pleasanton, CA",
};

// The prototype greeting name
export const OWNER_FIRST = "Mike";

// ---------- derived helpers (mirrors the prototype's calc functions) ----------

/**
 * Calculate quote subtotal / total for an estimate (ignores opt lines).
 *
 * TWO filters, not one. `opt` decides whether the line is on the bill at all; `notax` decides
 * whether it feeds the tax. A non-taxable line stays in `sub` and in `total` — it simply is not
 * in the base the rate is charged on. The discount comes off that base at the same rate it comes
 * off the bill, mirroring Estimate.totalsFrom's step order.
 *
 * KNOWN DIVERGENCE, PRE-DATING TAXABILITY: this is FLOAT DOLLARS with no rounding, while the
 * canonical chain (modules/quoting/domain/estimate.ts) is integer cents rounded at every step —
 * per line, then discount, then tax, then deposit. On odd-cent quotes the two land up to a cent
 * apart, and the office screens that render from here therefore show a figure the customer's own
 * document does not. Measured on the live 10% / 8.25% case behind commit 1cbc070 ($114.98 of
 * lines): the domain, the invoice and the customer's page all say $112.02; this says $112.014394,
 * which displays as $112.01. calc-quote-drift.test.ts pins that gap so it cannot widen unnoticed.
 * Closing it means rounding here to whole cents, which moves every office money display on an
 * odd-cent quote — a deliberate change, not a side effect of adding taxability.
 */
export function calcQuote(
  lines: SampleEstimateLine[],
  pricing?: { disc?: number; dep?: number; tax?: number }
): { sub: number; disc: number; taxed: number; total: number; dep: number } {
  const p = pricing ?? {};
  // Discount and deposit are shares of the bill and the domain refuses either outside 0..100%.
  // Clamped here as well as at the input: an out-of-range percentage arriving from anywhere else
  // used to run the discount past the subtotal and print totals like "+$-41" — a figure no
  // document could ever carry. Tax has no upper bound in the domain and keeps only its floor.
  const discPct = clampSharePct(p.disc ?? 0);
  const depPct = clampSharePct(p.dep ?? 0);
  const taxPct = Math.max(0, p.tax ?? 0);
  const billed = lines.filter((l) => !l.opt);
  const sub = billed.reduce((s, l) => s + l.q * l.r, 0);
  const taxBase = billed.filter((l) => !l.notax).reduce((s, l) => s + l.q * l.r, 0);
  const disc = sub * (discPct / 100);
  const taxed = (taxBase - taxBase * (discPct / 100)) * (taxPct / 100);
  const total = sub - disc + taxed;
  const dep = total * (depPct / 100);
  return { sub, disc, taxed, total, dep };
}

export function estTotal(e: SampleEstimate): number {
  return calcQuote(e.lines, e.pricing).total;
}

export function liveLeads(): SampleLead[] {
  return SAMPLE_LEADS.filter((l) => true); // none archived in sample
}

export function liveEsts(): SampleEstimate[] {
  return SAMPLE_ESTIMATES; // none archived in sample
}

/** Stage pill CSS class map (mirrors prototype's stagePillCls) */
export const STAGE_PILL_CLS: Record<string, string> = {
  "New customer": "ink",
  Contacted: "info",
  "Quote Sent": "warn",
  Won: "good",
  Lost: "bad",
};

/** Compute the Home KPIs exactly as the prototype's kpis() does */
export function sampleKpis() {
  const newWk = liveLeads().filter(
    (l) => l.stage === "New customer" || (l.stage === "Contacted" && l.age <= 7)
  ).length;
  const awaitEsts = liveEsts().filter((e) => e.status === "sent");
  const awaitSum = awaitEsts.reduce((s, e) => s + estTotal(e), 0);
  const wonSum = liveEsts()
    .filter((e) => e.status === "accepted")
    .reduce((s, e) => s + estTotal(e), 0);

  // Attention items — simplified: just count tasks overdue/today + unread leads
  // (full attention() is complex; the prototype shows 9 for this dataset)
  const PROTO_ATT_COUNT = 9;

  return { newWk, awaitN: awaitEsts.length, awaitSum, wonSum, att: PROTO_ATT_COUNT };
}

/** Compute the Finance KPIs from sample invoices */
export function sampleFinKpis() {
  const live = SAMPLE_INVOICES.filter((i) => !i.archived && i.status !== "draft");
  const collected = live.reduce((s, i) => {
    const paid = i.payments.reduce((a, p) => a + p.amt, 0);
    return s + paid + (i.depPaid ?? 0);
  }, 0);
  const unpaidItems = live.filter((i) => {
    const paid = i.payments.reduce((a, p) => a + p.amt, 0);
    return Math.max(0, i.total - (i.depPaid ?? 0) - paid) > 0;
  });
  const unpaid = unpaidItems.reduce((s, i) => {
    const paid = i.payments.reduce((a, p) => a + p.amt, 0);
    return s + Math.max(0, i.total - (i.depPaid ?? 0) - paid);
  }, 0);
  return { collected, unpaid };
}

/** Find a lead by id */
export function findLead(id: string): SampleLead | undefined {
  return SAMPLE_LEADS.find((l) => l.id === id);
}

/** Find an estimate by id */
export function findEst(id: string): SampleEstimate | undefined {
  return SAMPLE_ESTIMATES.find((e) => e.id === id);
}


/** Lead initials for avatar */
export function leadInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

