import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// --- Constants -----------------------------------------------------------

// Minimum duration for any visit type (minutes).
const VISIT_FLOOR_MINUTES = 15;

// Hour range: [0, 24] (0 = midnight, 24 = end-of-day).
const HOUR_MIN = 0;
const HOUR_MAX = 24;

// --- Value types ---------------------------------------------------------

export type ServiceLane = "repair" | "estimate" | "flat";

export interface BookingService {
  readonly name: string;
  readonly lane: ServiceLane;
  /** Price in DOLLARS (matches the prototype control — not cents). Optional for "estimate" lanes. */
  readonly price?: number;
  readonly triggers: string;
  /** Words that mean this service is an EMERGENCY (see today). */
  readonly emergencyTriggers?: string;
  /** Owner's rough price range the AI may state ONCE on an estimate call (e.g. '$150–$300'). SANCTIONED price. */
  readonly ballpark?: string;
  /** Certifications a tech must hold to be auto-dispatched this service (e.g. ["Gas"]). */
  readonly requiredCerts?: readonly string[];
}

/**
 * AI Front Desk booking playbook stored as a jsonb blob.
 * serviceFee is in DOLLARS (not cents) — documented to prevent misread.
 * The booking column is NOT NULL in org_settings, so every row must carry a complete value.
 * Use OrgSettings.defaultBooking() when constructing a first-run row.
 */
export interface BookingCfg {
  readonly services: BookingService[];
  readonly notServices: string;
  /** Service/diagnostic fee in DOLLARS (not cents). */
  readonly serviceFee: number;
  readonly feeCredited: boolean;
  /** Words that mean the AI should hand off to a human callback (insurance/claim/warranty/etc.). */
  readonly deferKeywords?: string;
  /**
   * E.164 number a TRUE-emergency call is transferred to live (the owner's or
   * on-call cell). Absent/empty = no live transfer — emergencies fall back to
   * the urgent-callback escalation. Normalized+validated at the API boundary.
   */
  readonly emergencyTransferNumber?: string;
}

// --- Props ---------------------------------------------------------------

// Note: the DB row surrogate `id` is intentionally NOT part of the domain model —
// the aggregate's identity is `orgId` (one settings row per org). The infra adapter
// (Task 5) upserts by `orgId` (the `org_settings_org_id_uq` conflict target), never
// by the surrogate `id`.
export interface OrgSettingsProps {
  readonly orgId: OrgId;
  readonly trade: string;
  /** Markup percentage in basis points (non-negative; 10000 = 100%). */
  readonly markupBps: number;
  /** Duration of a scoping visit (clamped to ≥ VISIT_FLOOR_MINUTES). */
  readonly visitScopeMinutes: number;
  /** Duration of a repair visit (clamped to ≥ VISIT_FLOOR_MINUTES). */
  readonly visitRepairMinutes: number;
  /** Duration of an install visit (clamped to ≥ VISIT_FLOOR_MINUTES). */
  readonly visitInstallMinutes: number;
  readonly techSeesPrice: boolean;
  readonly techTexts: boolean;
  readonly frontDesk: boolean;
  readonly scopeOn: boolean;
  /** Weekday open hour [0, 24]. */
  readonly hoursWdOpen: number;
  /** Weekday close hour [0, 24]. */
  readonly hoursWdClose: number;
  /** Saturday open hour [0, 24]. */
  readonly hoursSatOpen: number;
  /** Saturday close hour [0, 24]. */
  readonly hoursSatClose: number;
  /** Sunday open hour [0, 24]. */
  readonly hoursSunOpen: number;
  /** Sunday close hour [0, 24]. */
  readonly hoursSunClose: number;
  /** Comma/space-separated list of service-area cities. */
  readonly areaCities: string;
  /** Service area radius in miles (non-negative). */
  readonly areaRadiusMi: number;
  /**
   * Free-text address the service-area proximity is measured FROM. Nullable — a shop
   * may not have set one. Geocoded on save (best-effort) into originLat/originLng.
   */
  readonly serviceOriginAddress: string | null;
  /** Latitude of the geocoded service origin (WGS84). Null when unset or the geocode missed. */
  readonly originLat: number | null;
  /** Longitude of the geocoded service origin (WGS84). Null when unset or the geocode missed. */
  readonly originLng: number | null;
  readonly booking: BookingCfg;
  // --- Brand identity (all optional/nullable; brandName mirrors orgs.name) ---
  /** Business display name — mirrors orgs.name; NOT NULL. */
  readonly brandName: string;
  /** Short tagline or slogan. Nullable. */
  readonly brandTagline: string | null;
  /** Business website URL or domain. Nullable. */
  readonly brandSite: string | null;
  /** Brand accent color (hex string e.g. "#9C5B34"). Nullable. */
  readonly brandColor: string | null;
  /** URL to the logo asset. Nullable. */
  readonly brandLogoUrl: string | null;
  /** 1-3 character monogram initials. Nullable. */
  readonly brandInitials: string | null;
  // --- Stripe Connect (Express) onboarding state (PR1) ---
  /** The shop's Stripe connected account id (acct_...). Null until onboarding begins. */
  readonly stripeConnectedAccountId: string | null;
  /** Mirror of Stripe Account.charges_enabled. */
  readonly stripeChargesEnabled: boolean;
  /** Mirror of Stripe Account.payouts_enabled. */
  readonly stripePayoutsEnabled: boolean;
  /** Mirror of Stripe Account.details_submitted. */
  readonly stripeDetailsSubmitted: boolean;
  /** First time charges went live (stamped once). Null until then. */
  readonly stripeOnboardedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// --- Pure helpers --------------------------------------------------------

const clampMinutes = (n: number): number =>
  Math.max(VISIT_FLOOR_MINUTES, Math.round(Number.isFinite(n) ? n : 0));

const clampHour = (n: number): number =>
  Math.min(HOUR_MAX, Math.max(HOUR_MIN, Math.round(Number.isFinite(n) ? n : 0)));

// One day's [open, close] is valid iff it is the closed sentinel (0/0) or a forward range
// (open < close). Hours are clamped to [0, 24] first so the check matches what would be stored.
const isValidDayHours = (open: number, close: number): boolean => {
  const o = clampHour(open);
  const c = clampHour(close);
  return (o === 0 && c === 0) || o < c;
};

// The first day whose hours violate the invariant, anchored to that day's CLOSE field (the field the
// hours editor drives against a fixed open), or null when weekday/Saturday/Sunday are all valid.
const firstInvalidDayHours = (p: OrgSettingsProps): ValidationError | null => {
  if (!isValidDayHours(p.hoursWdOpen, p.hoursWdClose)) {
    return validation("weekday hours: closing time must be after opening time", "hoursWdClose");
  }
  if (!isValidDayHours(p.hoursSatOpen, p.hoursSatClose)) {
    return validation("Saturday hours: closing time must be after opening time", "hoursSatClose");
  }
  if (!isValidDayHours(p.hoursSunOpen, p.hoursSunClose)) {
    return validation("Sunday hours: closing time must be after opening time", "hoursSunClose");
  }
  return null;
};

// --- Aggregate -----------------------------------------------------------

/**
 * Org configuration aggregate. Enforces invariants on create/patch so an invalid OrgSettings
 * can never be constructed. All mutations return a new instance (immutability). The booking
 * column is NOT NULL in the DB — always supply OrgSettings.defaultBooking() for first-run rows.
 */
export class OrgSettings {
  private constructor(private readonly p: OrgSettingsProps) {}

  /**
   * Returns a complete, valid default BookingCfg suitable for a first-run org_settings row.
   * The booking column is NOT NULL with no DB default, so this factory is the single canonical
   * source for the initial value.
   */
  static defaultBooking(): BookingCfg {
    return {
      services: [],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
    };
  }

  /**
   * Constructs a validated OrgSettings. Returns Err<ValidationError> if any invariant is
   * violated; the aggregate is never constructed in an invalid state.
   *
   * Normalisations applied on success (not errors):
   *   - trade: trimmed
   *   - visit*Minutes: clamped to ≥ 15
   *   - hours*: clamped to [0, 24]
   *   - areaRadiusMi: rounded to nearest integer, floor 0
   */
  static create(props: OrgSettingsProps): Result<OrgSettings, ValidationError> {
    const trade = props.trade.trim();
    if (trade.length === 0) {
      return err(validation("trade is required", "trade"));
    }
    if (props.markupBps < 0) {
      return err(validation("markup must be non-negative", "markupBps"));
    }
    if (props.areaRadiusMi < 0) {
      return err(validation("area radius must be non-negative", "areaRadiusMi"));
    }
    // Brand name mirrors orgs.name (NOT NULL) — must not be blank.
    const brandName = props.brandName.trim();
    if (brandName.length === 0) {
      return err(validation("brand name is required", "brandName"));
    }
    // A stored Stripe connected account id must be a Stripe account id (acct_...). Null = not yet
    // onboarded. Guards against a client-supplied or malformed id ever reaching the charge path.
    if (props.stripeConnectedAccountId !== null && !props.stripeConnectedAccountId.startsWith("acct_")) {
      return err(validation("stripe connected account id must be an acct_ id", "stripeConnectedAccountId"));
    }
    // Business-hours invariant: each day is either CLOSED (open===0 && close===0, the schema sentinel)
    // or a valid forward range (open < close). A half-open (open=8, close=0), zero-width, or inverted
    // range reads as "closed" to the voice availability math and would silently route every caller to
    // voicemail — reject it at the boundary so no write path persists a silently-broken schedule.
    const hoursError = firstInvalidDayHours(props);
    if (hoursError) return err(hoursError);

    return ok(
      new OrgSettings({
        ...props,
        trade,
        brandName,
        visitScopeMinutes: clampMinutes(props.visitScopeMinutes),
        visitRepairMinutes: clampMinutes(props.visitRepairMinutes),
        visitInstallMinutes: clampMinutes(props.visitInstallMinutes),
        hoursWdOpen: clampHour(props.hoursWdOpen),
        hoursWdClose: clampHour(props.hoursWdClose),
        hoursSatOpen: clampHour(props.hoursSatOpen),
        hoursSatClose: clampHour(props.hoursSatClose),
        hoursSunOpen: clampHour(props.hoursSunOpen),
        hoursSunClose: clampHour(props.hoursSunClose),
        areaRadiusMi: Math.max(0, Math.round(props.areaRadiusMi)),
      }),
    );
  }

  /**
   * Returns a new OrgSettings with the supplied fields merged in and updatedAt stamped.
   * Undefined fields are unchanged. Re-validates all invariants through OrgSettings.create.
   * orgId and createdAt are immutable and cannot be patched.
   */
  patch(
    fields: Partial<Omit<OrgSettingsProps, "orgId" | "createdAt" | "updatedAt">>,
    now: Date,
  ): Result<OrgSettings, ValidationError> {
    return OrgSettings.create({
      ...this.p,
      trade: fields.trade !== undefined ? fields.trade : this.p.trade,
      markupBps: fields.markupBps !== undefined ? fields.markupBps : this.p.markupBps,
      visitScopeMinutes:
        fields.visitScopeMinutes !== undefined
          ? fields.visitScopeMinutes
          : this.p.visitScopeMinutes,
      visitRepairMinutes:
        fields.visitRepairMinutes !== undefined
          ? fields.visitRepairMinutes
          : this.p.visitRepairMinutes,
      visitInstallMinutes:
        fields.visitInstallMinutes !== undefined
          ? fields.visitInstallMinutes
          : this.p.visitInstallMinutes,
      techSeesPrice:
        fields.techSeesPrice !== undefined ? fields.techSeesPrice : this.p.techSeesPrice,
      techTexts: fields.techTexts !== undefined ? fields.techTexts : this.p.techTexts,
      frontDesk: fields.frontDesk !== undefined ? fields.frontDesk : this.p.frontDesk,
      scopeOn: fields.scopeOn !== undefined ? fields.scopeOn : this.p.scopeOn,
      hoursWdOpen: fields.hoursWdOpen !== undefined ? fields.hoursWdOpen : this.p.hoursWdOpen,
      hoursWdClose: fields.hoursWdClose !== undefined ? fields.hoursWdClose : this.p.hoursWdClose,
      hoursSatOpen:
        fields.hoursSatOpen !== undefined ? fields.hoursSatOpen : this.p.hoursSatOpen,
      hoursSatClose:
        fields.hoursSatClose !== undefined ? fields.hoursSatClose : this.p.hoursSatClose,
      hoursSunOpen:
        fields.hoursSunOpen !== undefined ? fields.hoursSunOpen : this.p.hoursSunOpen,
      hoursSunClose:
        fields.hoursSunClose !== undefined ? fields.hoursSunClose : this.p.hoursSunClose,
      areaCities: fields.areaCities !== undefined ? fields.areaCities : this.p.areaCities,
      areaRadiusMi:
        fields.areaRadiusMi !== undefined ? fields.areaRadiusMi : this.p.areaRadiusMi,
      // Service origin: undefined = keep current; explicit null clears it. lat/lng are patched
      // together with the address by the geocode-on-save flow (never set independently by clients).
      serviceOriginAddress:
        fields.serviceOriginAddress !== undefined
          ? fields.serviceOriginAddress
          : this.p.serviceOriginAddress,
      originLat: fields.originLat !== undefined ? fields.originLat : this.p.originLat,
      originLng: fields.originLng !== undefined ? fields.originLng : this.p.originLng,
      booking: fields.booking !== undefined ? fields.booking : this.p.booking,
      updatedAt: now,
    });
  }

  /**
   * Patch the brand-identity subset. undefined = keep current; explicit null
   * clears an optional field. brandName re-runs the NOT-NULL invariant via create.
   * Returns a new OrgSettings on success, or a ValidationError if the name is blank.
   */
  patchBrand(
    fields: {
      name?: string;
      tagline?: string | null;
      site?: string | null;
      color?: string | null;
      logoUrl?: string | null;
      initials?: string | null;
    },
    now: Date,
  ): Result<OrgSettings, ValidationError> {
    return OrgSettings.create({
      ...this.p,
      brandName: fields.name !== undefined ? fields.name : this.p.brandName,
      brandTagline: fields.tagline !== undefined ? fields.tagline : this.p.brandTagline,
      brandSite: fields.site !== undefined ? fields.site : this.p.brandSite,
      brandColor: fields.color !== undefined ? fields.color : this.p.brandColor,
      brandLogoUrl: fields.logoUrl !== undefined ? fields.logoUrl : this.p.brandLogoUrl,
      brandInitials: fields.initials !== undefined ? fields.initials : this.p.brandInitials,
      updatedAt: now,
    });
  }

  /**
   * Patch the Stripe Connect onboarding subset. undefined = keep current. Re-runs the acct_
   * invariant via create. onboardedAt is caller-controlled (the use case stamps it the first time
   * charges go live). Returns a new OrgSettings or a ValidationError.
   */
  patchStripe(
    fields: {
      connectedAccountId?: string | null;
      chargesEnabled?: boolean;
      payoutsEnabled?: boolean;
      detailsSubmitted?: boolean;
      onboardedAt?: Date | null;
    },
    now: Date,
  ): Result<OrgSettings, ValidationError> {
    return OrgSettings.create({
      ...this.p,
      stripeConnectedAccountId:
        fields.connectedAccountId !== undefined
          ? fields.connectedAccountId
          : this.p.stripeConnectedAccountId,
      stripeChargesEnabled:
        fields.chargesEnabled !== undefined ? fields.chargesEnabled : this.p.stripeChargesEnabled,
      stripePayoutsEnabled:
        fields.payoutsEnabled !== undefined ? fields.payoutsEnabled : this.p.stripePayoutsEnabled,
      stripeDetailsSubmitted:
        fields.detailsSubmitted !== undefined
          ? fields.detailsSubmitted
          : this.p.stripeDetailsSubmitted,
      stripeOnboardedAt:
        fields.onboardedAt !== undefined ? fields.onboardedAt : this.p.stripeOnboardedAt,
      updatedAt: now,
    });
  }

  get props(): OrgSettingsProps {
    return this.p;
  }
}
