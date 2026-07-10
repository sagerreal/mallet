"use client";

/**
 * Settings → Workspace → Branding card. Reads the hydrated store `brand`
 * (BrandHydrator seeds it) and persists edits via updateBrand (optimistic +
 * v1.settings.updateBrand). Replaces the prototype's SAMPLE_BRAND no-op save.
 * Logo image upload is deferred to the Phase-5 storage helper; brand_logo_url
 * accepts a URL string here so text + colour ship now.
 */

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { FoldCard } from "./fold-card";

const inputStyle = {
  flex: 1, minWidth: 160, border: "1.5px solid var(--line)", borderRadius: 8,
  padding: "8px 10px", fontFamily: "inherit", fontSize: 13,
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
  const [saved, setSaved] = useState(false);

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
    setSaved(false);
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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <FoldCard title="Branding" summary={name} defaultOpen>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div className="custlogo" style={{ background: color, color: "#fff" }}>
          {(initials || name.slice(0, 2)).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{name}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {tagline}{tagline && site ? " · " : ""}{site}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="brandName">Business name</label>
          <input id="brandName" type="text" value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }} style={inputStyle} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="brandTagline">Tagline</label>
          <input id="brandTagline" type="text" value={tagline}
            onChange={(e) => { setTagline(e.target.value); markDirty(); }}
            placeholder="Licensed & insured · Your city" style={inputStyle} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="brandSite">Website</label>
          <input id="brandSite" type="text" value={site}
            onChange={(e) => { setSite(e.target.value); markDirty(); }}
            placeholder="yourbusiness.com" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="brandColor">Brand colour</label>
            <input id="brandColor" type="color" value={color || "#6B7280"}
              onChange={(e) => { setColor(e.target.value); markDirty(); }}
              style={{ width: 56, height: 34, border: "1.5px solid var(--line)", borderRadius: 8, padding: 2 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="brandInitials">Initials</label>
            <input id="brandInitials" type="text" maxLength={3} value={initials}
              onChange={(e) => { setInitials(e.target.value); markDirty(); }}
              style={{ width: 72, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button className="btn primary" onClick={handleSave} disabled={!name.trim()}>Save</button>
        {saved && <span style={{ color: "var(--green-900)", fontSize: 12, fontWeight: 600 }}>Saved ✓</span>}
      </div>
    </FoldCard>
  );
}
