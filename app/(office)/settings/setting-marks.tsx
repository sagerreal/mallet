/**
 * app/(office)/settings/setting-marks.tsx
 * A small mark per settings row, so a stack of rows stops reading as one grey wall.
 *
 * WHY A GLYPH AND NOT A LOGO. The obvious answer to "these all look the same" is the vendors' own
 * logos, and it is the wrong one here for three reasons: the app is deliberately MONOCHROME and warm
 * (there is no green anywhere in the palette on purpose), so a row of brand colours would be the
 * loudest thing on any screen in Mallet; the artifact CSP blocks remote images, so each one would
 * have to be an inlined copy of somebody's trademark; and half these rows are not vendors at all —
 * "Website form" and "Import" have no logo to borrow.
 *
 * So: one ink glyph on a quiet tile, seven distinct SHAPES. Shape carries the distinction, which is
 * what the eye actually scans for in a list, and it works for the Mallet-native rows and the
 * third-party ones alike. If real vendor marks are wanted later, this is the seam they slot into.
 *
 * Every glyph is drawn from the thing the row DOES — a card, a contactless wave, a ledger, a message,
 * a shop awning, a form, a tray — never a decorative abstraction. Decoration in a settings list is
 * noise pretending to be information.
 */

const Glyph = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Card on file — the money rail. */
export const MarkPayments = () => (
  <Glyph>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M2.5 10h19" />
  </Glyph>
);

/** Contactless waves off a phone edge. */
export const MarkTapToPay = () => (
  <Glyph>
    <rect x="3" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />
  </Glyph>
);

/** A ledger — the book the hours land in. */
export const MarkQuickBooks = () => (
  <Glyph>
    <path d="M4 4.5h11.5a3 3 0 0 1 3 3v12H7a3 3 0 0 1-3-3z" />
    <path d="M4 16.5h14.5M8.5 8.5h6" />
  </Glyph>
);

/** A message going out. */
export const MarkTexting = () => (
  <Glyph>
    <path d="M20.5 15a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5v-15A2.5 2.5 0 0 1 6.5 3.5h11.5A2.5 2.5 0 0 1 20.5 6z" />
    <path d="M8.5 8.5h8M8.5 12h5" />
  </Glyph>
);

/** A shop awning — somebody else's storefront sending work over. */
export const MarkMarketplaces = () => (
  <Glyph>
    <path d="M3 8.5 4.5 4h15L21 8.5" />
    <path d="M3 8.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" />
    <path d="M5 11v9h14v-9" />
  </Glyph>
);

/** A form with a filled-in line — your own site. */
export const MarkWebsiteForm = () => (
  <Glyph>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M3.5 8h17M7.5 12h9M7.5 16h5" />
  </Glyph>
);

/** Into the tray — a one-time move-in. */
export const MarkImport = () => (
  <Glyph>
    <path d="M12 3.5v10M8 10l4 4 4-4" />
    <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Glyph>
);

/** The company's own look. */
export const MarkBranding = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17M3.5 12h17" />
  </Glyph>
);

/** The paperwork a customer receives. */
export const MarkDocuments = () => (
  <Glyph>
    <path d="M6 3.5h8l4.5 4.5v13H6z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
  </Glyph>
);

/** Who the company is on record. */
export const MarkBusiness = () => (
  <Glyph>
    <path d="M4 20.5V6.5l7-3 7 3v14" />
    <path d="M8 11h6M8 15h6M4 20.5h16" />
  </Glyph>
);

/** A rate applied to money. */
export const MarkTax = () => (
  <Glyph>
    <path d="M7 17 17 7" />
    <circle cx="8" cy="8" r="2.2" />
    <circle cx="16" cy="16" r="2.2" />
  </Glyph>
);

/** Where "today" is. */
export const MarkClock = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.5l3.5 2" />
  </Glyph>
);

/** The roster. */
export const MarkTeam = () => (
  <Glyph>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.7a3.2 3.2 0 0 1 0 5.6M17.5 14.9c2 .7 3.5 2.6 3.5 5.1" />
  </Glyph>
);

/** What a person is allowed to see. */
export const MarkPermissions = () => (
  <Glyph>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Glyph>
);

/** The punch clock itself. */
export const MarkPunch = () => (
  <Glyph>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
    <path d="M3.5 9h17M12 12v4M9.5 14h5" />
  </Glyph>
);

/** The week a person is expected to work. */
export const MarkSchedule = () => (
  <Glyph>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Glyph>
);

/** The vocabulary leads get tagged with. */
export const MarkSources = () => (
  <Glyph>
    <path d="M3.5 6.5h17M3.5 12h11M3.5 17.5h6" />
  </Glyph>
);

/** This person, as opposed to the company. */
export const MarkYou = () => (
  <Glyph>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.5 20.5c0-3.8 3.4-6.3 7.5-6.3s7.5 2.5 7.5 6.3" />
  </Glyph>
);

/** The phone that rings first. */
export const MarkPhone = () => (
  <Glyph>
    <path d="M7.5 3.5h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
    <path d="M10.5 17.5h3" />
  </Glyph>
);
