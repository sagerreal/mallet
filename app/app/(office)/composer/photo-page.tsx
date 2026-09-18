"use client";

/**
 * The photos on a proposal page — one image, or a BEFORE/AFTER pair.
 *
 * The pair is the point. A trade's proof is not a gallery, it is "this is what we walked into
 * and this is what we left" side by side, and every tool that makes a shop assemble that out of
 * two separate uploads gets used once.
 *
 * Images can be pasted as well as picked: the office is usually coming from a phone gallery or
 * a text thread, and pasting is one gesture instead of a save-then-find.
 *
 * Nothing here holds a URL. The page keeps storage KEYS, and short-lived links are minted for
 * viewing — see PresentationPhoto for why a URL in a snapshot is the wrong thing.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import {
  uploadProposalPhoto,
  ImageTooLargeError,
  UnsupportedImageError,
} from "@/lib/store/upload-proposal-photo";
import type { ComposerPhoto } from "./presentation-state";

const ACCEPT = ".jpg,.jpeg,.png,.webp";

/** Which half of an entry a file is going into. */
type Slot = "after" | "before";

export function PhotoPage({
  photos,
  onChange,
  readOnly,
}: {
  photos: readonly ComposerPhoto[];
  onChange: (next: ComposerPhoto[]) => void;
  /** A quote already sent — its photos are the ones it was sent with. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<{ id: string; slot: Slot } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // The links are minted per view and expire; the office's copy re-asks whenever the set changes.
  const keys = photos.flatMap((p) => (p.beforeKey ? [p.key, p.beforeKey] : [p.key]));
  const urlsQuery = api.v1.quoting.proposalPhotoUrls.useQuery(
    { keys },
    { enabled: keys.length > 0, refetchOnWindowFocus: false },
  );
  const urlFor = (key: string) => urlsQuery.data?.urls.find((u) => u.key === key)?.url;

  const upload = async (file: File, into: { id: string; slot: Slot } | null) => {
    setBusy(true);
    setError(null);
    try {
      const key = await uploadProposalPhoto(file);
      if (into === null) {
        onChange([...photos, { id: crypto.randomUUID(), key }]);
      } else {
        onChange(
          photos.map((photo) =>
            photo.id !== into.id
              ? photo
              : into.slot === "before"
                ? { ...photo, beforeKey: key }
                : { ...photo, key },
          ),
        );
      }
    } catch (e: unknown) {
      setError(
        e instanceof UnsupportedImageError || e instanceof ImageTooLargeError
          ? e.message
          : "That photo didn't upload — check your connection and try again.",
      );
    } finally {
      setBusy(false);
      target.current = null;
    }
  };

  // Paste anywhere on the page while it is open. The office arrives from a phone gallery or a
  // text thread far more often than from a file browser.
  useEffect(() => {
    if (readOnly) return undefined;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])][0];
      if (file) void upload(file, null);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // upload closes over `photos`; re-binding on change is what keeps an append from dropping one.
  }, [photos, readOnly]);

  const pick = (into: { id: string; slot: Slot } | null) => {
    target.current = into;
    picker.current?.click();
  };

  return (
    <>
      <div className="docphotos">
        {photos.map((photo) => (
          <figure key={photo.id} className={photo.beforeKey ? "docphoto pair" : "docphoto"}>
            {photo.beforeKey ? (
              <div className="docphoto-pair">
                <Slotted url={urlFor(photo.beforeKey)} tag="Before" />
                <Slotted url={urlFor(photo.key)} tag="After" />
              </div>
            ) : (
              <Slotted url={urlFor(photo.key)} />
            )}
            {photo.caption ? <figcaption className="docphoto-cap">{photo.caption}</figcaption> : null}
            {!readOnly && (
              <div className="linehints">
                {!photo.beforeKey && (
                  <button
                    type="button"
                    className="linehint"
                    onClick={() => pick({ id: photo.id, slot: "before" })}
                  >
                    + Before photo
                  </button>
                )}
                <button
                  type="button"
                  className="linehint"
                  onClick={() => onChange(photos.filter((p) => p.id !== photo.id))}
                >
                  Remove
                </button>
              </div>
            )}
          </figure>
        ))}
        {!readOnly && (
          <button type="button" className="docphoto-slot empty" onClick={() => pick(null)} disabled={busy}>
            {busy ? "Uploading…" : "Add a photo — or paste one"}
          </button>
        )}
      </div>
      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {error}
        </p>
      )}
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file, target.current);
        }}
      />
    </>
  );
}

/**
 * One image slot. An empty one says it is empty rather than showing a grey rectangle — the
 * office needs to know whether a photo is missing or still arriving.
 */
function Slotted({ url, tag }: { url?: string; tag?: string }) {
  return (
    <div
      className={url ? "docphoto-slot" : "docphoto-slot empty"}
      style={url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined}
      role="img"
      aria-label={tag ? `${tag} photo` : "Photo"}
    >
      {tag ? <span className="docphoto-tag">{tag}</span> : null}
      {!url ? <span>Loading…</span> : null}
    </div>
  );
}
