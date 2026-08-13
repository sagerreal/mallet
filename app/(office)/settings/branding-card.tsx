"use client";

/**
 * Settings → Workspace → Branding card. Reads the hydrated store `brand`
 * (BrandHydrator seeds it) and persists edits via updateBrand (optimistic +
 * v1.settings.updateBrand). Replaces the prototype's SAMPLE_BRAND no-op save.
 *
 * The preview is a live, WYSIWYG replica of the header a customer sees atop a
 * quote or invoice (mirrors CustHead in cust-quote-modal): a brand-colour
 * banner, a light chip with the brand-colour initials, name, and tagline. That
 * is the whole point of this card — it controls how the shop appears to its
 * customers on the documents it sends.
 *
 * Logo image upload is deferred to the Phase-5 storage helper; brand_logo_url
 * accepts a URL string here so text + colour ship now.
 */

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { FoldCard } from "./fold-card";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { MarkBranding } from "./setting-marks";

// Fallback so the preview banner + chip are never invisible when a fresh org
// has no brand colour yet. Matches the app's warm-theme accent (near-black).
const DEFAULT_BRAND_COLOR = "#1A1510";

const inputStyle = {
  flex: 1, minWidth: 160, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)",
} as const;

export function BrandingCard() {
  const brand = useAppStore((s) => s.brand);
  const updateBrand = useAppStore((s) => s.updateBrand);

  // Draft mirrors the store brand; edits are local until Save (so an optimistic
  // reconcile mid-typing does not yank the field out from under the user).
  const [name, setName] = useState(brand.name);
  const [tagline, setTagline] = useState(brand.tagline);
  const [site, setSite] = useState(brand.site);
  const [color, setColor] = useState(brand.color);
  const [initials, setInitials] = useState(brand.initials);
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  // dirty: true once the user has made any edit; prevents BrandHydrator's
  // async resolution from clobbering an in-progress form.
  const [dirty, setDirty] = useState(false);

  // Re-sync draft from the store when brand changes (e.g. BrandHydrator resolves
  // after mount), but only while the user has not started editing.
  useEffect(() => {
    if (dirty) return;
    setName(brand.name);
    setTagline(brand.tagline);
    setSite(brand.site);
    setColor(brand.color);
    setInitials(brand.initials);
  }, [brand, dirty]);

  function markDirty() {
    setDirty(true);
    resetSaved();
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return; // brand name maps to NOT NULL orgs.name
    updateBrand({
      name: trimmed,
      tagline: tagline.trim() || "",
      site: site.trim() || "",
      color: color || "",
      initials: (initials.trim() || trimmed.slice(0, 2)).toUpperCase(),
    });
    setDirty(false);
    flash();
  }

  const previewColor = color || DEFAULT_BRAND_COLOR;
  const previewInitials = (initials || name.slice(0, 2)).toUpperCase();
  const previewName = name.trim() || "Your business";
  const previewSub = [tagline.trim(), site.trim()].filter(Boolean).join(" · ");

  return (
    <FoldCard title="Branding" mark={<MarkBranding />} summary={name} defaultOpen>
      {/* Live WYSIWYG preview — the exact header a customer sees atop a quote or
          invoice (mirrors CustHead in cust-quote-modal). */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, marginBottom: "var(--space-2)" }}>
          How you appear on quotes &amp; invoices
        </div>
        <div style={{ borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--line)" }}>
          <div className="custhead" style={{ background: previewColor }}>
            <div className="custlogo" style={{ color: previewColor }}>{previewInitials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: "var(--type-lg)", lineHeight: 1.2 }}>{previewName}</div>
              {previewSub && (
                <div style={{ fontSize: "var(--type-sm)", opacity: 0.85, marginTop: "var(--space-2xs)" }}>{previewSub}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <div className="field" style={{ margin: "0" }}>
          <label htmlFor="brandName">Business name</label>
          <input id="brandName" type="text" value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }} style={inputStyle} />
        </div>
        <div className="field" style={{ margin: "0" }}>
          <label htmlFor="brandTagline">Tagline</label>
          <input id="brandTagline" type="text" value={tagline}
            onChange={(e) => { setTagline(e.target.value); markDirty(); }}
            placeholder="Licensed & insured · Your city" style={inputStyle} />
        </div>
        <div className="field" style={{ margin: "0" }}>
          <label htmlFor="brandSite">Website</label>
          <input id="brandSite" type="text" value={site}
            onChange={(e) => { setSite(e.target.value); markDirty(); }}
            placeholder="yourbusiness.com" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: "0" }}>
            <label htmlFor="brandColor">Brand colour</label>
            <input id="brandColor" type="color" value={color || DEFAULT_BRAND_COLOR}
              onChange={(e) => { setColor(e.target.value); markDirty(); }}
              style={{ width: 56, height: 34, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2xs)" }} />
          </div>
          <div className="field" style={{ margin: "0" }}>
            <label htmlFor="brandInitials">Initials</label>
            <input id="brandInitials" type="text" maxLength={3} value={initials}
              onChange={(e) => { setInitials(e.target.value); markDirty(); }}
              style={{ width: 72, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
        <button className="btn primary" onClick={handleSave} disabled={!name.trim()}>Save</button>
        <SavedFlash saved={saved} />
      </div>
    </FoldCard>
  );
}
