/**
 * lib/images/blob-to-base64.ts
 * Browser-only: encode an image Blob as bare base64 for an inline API payload.
 *
 * Used by the Ask screen's camera when there is no job to file the photo against — the bytes ride
 * with the question instead of taking a storage round trip. Returns the payload WITHOUT the
 * `data:<mime>;base64,` prefix, because the media type travels as its own field and the copilot
 * endpoint validates a bare base64 string.
 */

/**
 * @throws When the reader fails or yields an unexpected result shape.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blobToBase64: could not read the image"));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("blobToBase64: reader returned a non-string result"));
    };
    reader.readAsDataURL(blob);
  });

  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("blobToBase64: reader returned a malformed data URL");
  return dataUrl.slice(comma + 1);
}
