/**
 * The photos on a proposal page, as the customer sees them — one image, or a BEFORE/AFTER pair.
 *
 * A server component: the links are signed on the server and handed down, because the visitor
 * has no session and the bucket is private. Nothing here fetches.
 *
 * An image whose link could not be minted is skipped rather than rendered broken. A quote is
 * not worth failing over a decoration that has gone missing from storage.
 */

interface Photo {
  readonly id: string;
  readonly key: string;
  readonly beforeKey?: string | null;
  readonly caption?: string | null;
}

export function ProposalPhotos({
  photos,
  urls,
}: {
  photos: readonly Photo[];
  urls: ReadonlyMap<string, string>;
}) {
  const shown = photos.filter((photo) => urls.has(photo.key));
  if (shown.length === 0) return null;
  return (
    <div className="docphotos" style={{ marginTop: "var(--space-3)" }}>
      {shown.map((photo) => {
        const before = photo.beforeKey ? urls.get(photo.beforeKey) : undefined;
        return (
          <figure key={photo.id} className={before ? "docphoto pair" : "docphoto"}>
            {before ? (
              <div className="docphoto-pair">
                <Slot url={before} tag="Before" />
                <Slot url={urls.get(photo.key)!} tag="After" />
              </div>
            ) : (
              <Slot url={urls.get(photo.key)!} />
            )}
            {photo.caption ? <figcaption className="docphoto-cap">{photo.caption}</figcaption> : null}
          </figure>
        );
      })}
    </div>
  );
}

function Slot({ url, tag }: { url: string; tag?: string }) {
  return (
    <div
      className="docphoto-slot"
      style={{ backgroundImage: `url(${JSON.stringify(url)})` }}
      role="img"
      aria-label={tag ? `${tag} photo` : "Project photo"}
    >
      {tag ? <span className="docphoto-tag">{tag}</span> : null}
    </div>
  );
}
