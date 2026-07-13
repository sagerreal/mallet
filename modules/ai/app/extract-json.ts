/**
 * Text-fallback JSON extraction shared by the one-shot estimate drafters.
 *
 * A well-instructed model with a single forced tool should never answer in
 * prose — but when it does, scan the text for balanced `{…}` spans and return
 * the first one that parses as JSON AND validates via `parse`.
 */
export const extractJsonFromText = <T>(
  text: string,
  parse: (candidate: unknown) => T | null,
): T | null => {
  // Find all candidate JSON substrings by scanning for `{`.
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j += 1) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    try {
      const candidate: unknown = JSON.parse(text.slice(i, j + 1));
      const parsed = parse(candidate);
      if (parsed) return parsed;
    } catch {
      // not valid JSON — keep scanning
    }
  }
  return null;
};
