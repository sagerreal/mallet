import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, Phone } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Geocoder } from "@mallet/frontdesk";
import type { OrgSettings, OrgSettingsProps } from "../domain/org-settings";
import type { SettingsRepository } from "../domain/settings-repository";
import { defaultBooking } from "./default-booking";

// Fields the caller may change — orgId and timestamps are server-owned and not patchable.
// originLat/originLng are also NOT client-supplied: they are derived here by geocoding the
// address, so callers pass at most serviceOriginAddress and the use-case fills the point.
export type UpdateConfigCommand = Partial<
  Omit<OrgSettingsProps, "orgId" | "createdAt" | "updatedAt" | "originLat" | "originLng">
>;

/**
 * Normalizes the booking blob before it is patched in:
 * emergencyTransferNumber → canonical E.164 (the DTO already validated it), and
 * ""/whitespace → the field is dropped entirely (transfer off — never store "").
 * Everything else passes through untouched.
 */
function normalizeBooking(cmd: UpdateConfigCommand): UpdateConfigCommand {
  if (!cmd.booking) return cmd;
  const raw = cmd.booking.emergencyTransferNumber;
  if (raw === undefined) return cmd;
  const trimmed = raw.trim();
  if (trimmed === "") {
    const { emergencyTransferNumber: _off, ...rest } = cmd.booking;
    return { ...cmd, booking: rest };
  }
  const parsed = Phone.parse(trimmed);
  return {
    ...cmd,
    booking: { ...cmd.booking, emergencyTransferNumber: parsed.ok ? parsed.value : trimmed },
  };
}

/**
 * Patch the scalar/jsonb config for an org. Lazily materialises the row first so an org that has
 * never opened Settings can still save (idempotent upsert via repo.getConfig).
 *
 * Geocode-on-save: when serviceOriginAddress is present in the command AND differs from the stored
 * value, the injected Geocoder resolves it to a point that is persisted as originLat/originLng
 * (null when the geocode misses — the address is still saved). An unchanged address is NOT
 * re-geocoded. A geocode miss is logged and NEVER fails the save (the port never throws, but we
 * defensively catch anyway). The Geocoder is optional; when absent, the address is saved without
 * geocoding (lat/lng cleared) — used by callers that don't wire a geocoder.
 */
export class UpdateConfigUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
    private readonly geocoder?: Geocoder,
  ) {}

  async exec(cmd: UpdateConfigCommand, orgId: string): Promise<Result<OrgSettings, AppError>> {
    const current = await this.repo.getConfig(orgId, defaultBooking);

    // Derive the origin point when the address is being set to a new, non-empty value. Trim so a
    // whitespace-only change doesn't re-geocode; compare against the stored value to skip no-ops.
    const originPatch = await this.resolveOriginPatch(cmd, current.props.serviceOriginAddress);

    const patched = current.patch({ ...normalizeBooking(cmd), ...originPatch }, this.clock.now());
    if (!patched.ok) return patched;
    await this.repo.saveConfig(patched.value);
    logger.info({ orgId }, "settings.config.updated");
    return ok(patched.value);
  }

  /**
   * Computes the { serviceOriginAddress?, originLat?, originLng? } patch for the origin.
   * - address absent from cmd → {} (leave everything as-is; never re-geocode)
   * - address present but unchanged from stored → {} (no re-geocode)
   * - address present and changed → geocode; lat/lng from the point, or null on a miss/empty
   */
  private async resolveOriginPatch(
    cmd: UpdateConfigCommand,
    storedAddress: string | null,
  ): Promise<Partial<Pick<OrgSettingsProps, "serviceOriginAddress" | "originLat" | "originLng">>> {
    if (cmd.serviceOriginAddress === undefined) return {};

    const next = cmd.serviceOriginAddress;
    const normalizedNext = next?.trim() ? next.trim() : null;
    const normalizedStored = storedAddress?.trim() ? storedAddress.trim() : null;

    // Unchanged address (including null→null) — do NOT re-geocode; leave the stored point intact.
    if (normalizedNext === normalizedStored) return {};

    // Cleared address — drop the point too.
    if (normalizedNext === null) {
      return { serviceOriginAddress: null, originLat: null, originLng: null };
    }

    // Changed to a real address — geocode (best-effort). A miss or a missing geocoder leaves
    // lat/lng null; the address is still saved. The port never throws, but guard defensively so a
    // provider bug can never fail the save.
    let point = null;
    if (this.geocoder) {
      try {
        point = await this.geocoder.geocode(normalizedNext);
      } catch (e) {
        logger.warn({ err: e }, "settings.origin.geocode threw");
        point = null;
      }
    }
    if (!point) {
      logger.info({ address: normalizedNext }, "settings.origin.geocode miss");
    }
    return {
      serviceOriginAddress: normalizedNext,
      originLat: point?.lat ?? null,
      originLng: point?.lng ?? null,
    };
  }
}
