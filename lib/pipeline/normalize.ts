/**
 * Entity normalization and value canonicalization.
 * 
 * Entity resolution: fuzzy matching to canonicalize name variants
 * ("XYZ Corp" vs "XYZ Corporation" vs "XYZ Limited")
 * 
 * Value normalization: extract numeric values from strings for comparison
 */

// ─── Entity Normalization ─────────────────────────────────────────────────────

/**
 * Normalize an entity name for canonical storage.
 * Strips common suffixes and lowercases for comparison, but preserves original casing for display.
 */
export function normalizeEntityName(name: string): string {
  return name
    .trim()
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove trailing punctuation
    .replace(/[.,;:]+$/, '')
    .trim();
}

/**
 * Compute a canonical key for entity matching (lowercase, stripped suffixes)
 */
export function entityCanonicalKey(name: string): string {
  const suffixes = [
    'limited', 'ltd', 'ltd.', 'llc', 'inc', 'inc.', 'corp', 'corp.',
    'corporation', 'pvt', 'pvt.', 'private', 'plc', 'co.', 'co',
    'company', 'group', 'holdings', 'international', 'global',
  ];

  let key = name.toLowerCase().replace(/[.,]/g, '').trim();

  // Remove company suffixes for matching
  for (const suffix of suffixes) {
    const pattern = new RegExp(`\\b${suffix}\\b`, 'g');
    key = key.replace(pattern, '').trim();
  }

  // Normalize whitespace again
  key = key.replace(/\s+/g, ' ').trim();
  return key;
}

/**
 * Simple string similarity score (Jaccard on bigrams)
 */
function bigramSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const result = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2));
    return result;
  };

  const aSet = bigrams(a);
  const bSet = bigrams(b);
  const intersection = new Set([...aSet].filter((x) => bSet.has(x)));
  const union = new Set([...aSet, ...bSet]);
  if (union.size === 0) return a === b ? 1 : 0;
  return intersection.size / union.size;
}

/**
 * Find the best matching canonical entity from a list of known entities.
 * Returns the canonical name if similarity > threshold, else returns normalized input.
 */
export function resolveEntityCanonical(
  rawName: string,
  knownCanonicals: string[],
  threshold = 0.6
): string {
  const normalized = normalizeEntityName(rawName);
  const key = entityCanonicalKey(rawName);

  let bestMatch = normalized;
  let bestScore = 0;

  for (const known of knownCanonicals) {
    const knownKey = entityCanonicalKey(known);
    const score = bigramSimilarity(key, knownKey);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = known;
    }
  }

  return bestScore >= threshold ? bestMatch : normalized;
}

// ─── Value Normalization ──────────────────────────────────────────────────────

/**
 * Try to extract a numeric value from a string.
 * Handles: "42.3 million", "$1.2B", "1,500", "15%", "₹500 crore"
 */
export function normalizeNumericValue(value: string, unit?: string): number | null {
  if (!value) return null;

  const text = value.toLowerCase().trim();

  // Extract raw number
  const numberMatch = text.match(/[-+]?\d[\d,]*\.?\d*/);
  if (!numberMatch) return null;

  let num = parseFloat(numberMatch[0].replace(/,/g, ''));
  if (isNaN(num)) return null;

  // Apply multipliers from value or unit
  const combined = `${text} ${(unit ?? '').toLowerCase()}`;

  if (/\btrillion\b/.test(combined)) num *= 1e12;
  else if (/\bbillion\b|\b[bB]\b/.test(combined)) num *= 1e9;
  else if (/\bmillion\b|\bmn\b|\bm\b/.test(combined)) num *= 1e6;
  else if (/\blakh\b/.test(combined)) num *= 1e5;
  else if (/\bthousand\b|\bk\b/.test(combined)) num *= 1e3;
  else if (/\bcrore\b/.test(combined)) num *= 1e7;

  return num;
}

/**
 * Normalize attribute strings to be comparable across documents.
 * e.g. "Annual Revenue" → "annual revenue", "Net Profit After Tax" → "net profit after tax"
 */
export function normalizeAttribute(attribute: string): string {
  return attribute.toLowerCase().trim().replace(/\s+/g, ' ');
}
