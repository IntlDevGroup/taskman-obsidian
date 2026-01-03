/**
 * FNV-1a 32-bit hash. Fast, deterministic, good distribution.
 * Not cryptographic - just for generating keys.
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Normalize a task line for matching purposes.
 * - Strips trailing HTML comment (<!--todo:...-->)
 * - Normalizes checkbox state to unchecked
 * - Collapses whitespace
 * - Lowercases
 */
export function normalizeForMatch(line: string): string {
  const noComment = line.replace(/\s*<!--todo:.*?-->\s*$/i, "").trim();
  const normalizedCheckbox = noComment.replace(/^- \[( |x|X)\]/, "- [ ]");
  return normalizedCheckbox.replace(/\s+/g, " ").trim().toLowerCase();
}