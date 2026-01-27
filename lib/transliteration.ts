/**
 * Transliteration - Arabic/French/English Search Normalization
 *
 * Morocco is multilingual. Users might search in Arabic, French, or English:
 * - 'tagine' (English)
 * - 'tajine' (French spelling)
 * - 'طاجين' (Arabic)
 *
 * This module provides:
 * 1. A mapping table of canonical terms to their variants
 * 2. Index-time expansion to make content searchable by all variants
 * 3. Query-time normalization to map variants to canonical form
 * 4. Arabic-specific text normalization
 */

// ============================================================================
// Transliteration Mappings
// ============================================================================

/**
 * Canonical Moroccan dish/food terms mapped to their variants
 *
 * Format: canonical (English/common) -> [French, Arabic variants]
 * The canonical form is what we store in the index; variants are what users search.
 */
export const MOROCCAN_FOOD_TRANSLITERATIONS: Record<string, string[]> = {
  // Main dishes
  tagine: ["tajine", "طاجين", "طجين", "الطاجين"],
  couscous: ["كسكس", "كسكسو", "الكسكس", "koskos", "kuskus"],
  pastilla: ["bastilla", "bestilla", "بسطيلة", "البسطيلة", "pastela"],
  harira: ["حريرة", "الحريرة", "hrira"],
  tanjia: ["tangia", "طنجية", "الطنجية"],
  mechoui: ["meshwi", "مشوي", "المشوي", "mchoui"],
  rfissa: ["رفيسة", "الرفيسة", "trid"],
  mrouzia: ["مروزية", "المروزية"],
  kefta: ["كفتة", "الكفتة", "kofta", "kofte", "kafta"],
  brochettes: ["بروشات", "شواء", "brochette", "skewers"],
  sardines: ["سردين", "sardine"],

  // Breads and pastries
  msemen: ["مسمن", "المسمن", "msemmen", "rghaif"],
  baghrir: ["بغرير", "البغرير", "beghrir", "thousand holes"],
  harcha: ["حرشة", "الحرشة"],
  khobz: ["خبز", "الخبز", "bread", "pain"],
  batbout: ["بطبوط", "البطبوط"],
  mlawi: ["ملاوي", "الملاوي", "meloui"],
  chebakia: ["شباكية", "الشباكية", "chebakiya"],
  briouates: ["بريوات", "البريوات", "briouate", "briwat"],
  kaab: ["كعب الغزال", "kaab ghazal", "gazelle horns"],
  sellou: ["سلو", "السلو", "sfouf", "zamita"],

  // Salads and sides
  zaalouk: ["زعلوك", "الزعلوك"],
  taktouka: ["تكتوكة", "التكتوكة"],
  bissara: ["بصارة", "البصارة", "bessara"],

  // Drinks
  atay: ["أتاي", "الشاي", "mint tea", "the menthe", "the a la menthe", "moroccan tea"],
  jus: ["عصير", "juice", "jus d'orange"],

  // Sweets (note: "kaab" above covers "kaab ghazal" / "gazelle horns" / "كعب الغزال")
  gazelle: ["غزال"],  // Just the animal, kaab entry handles the pastry
  ghriba: ["غريبة", "الغريبة", "ghoriba"],
  fekkas: ["فقاص", "الفقاص", "feqqas"],

  // Common ingredients/terms
  smen: ["سمن", "السمن", "preserved butter"],
  chermoula: ["شرمولة", "الشرمولة", "charmoula"],
  ras: ["راس الحانوت", "ras el hanout", "ras hanout"],
  preserved: ["مصير", "citron confit", "preserved lemons", "lemon"],
  olives: ["زيتون", "الزيتون", "olive"],
  argan: ["أركان", "الأركان", "argan oil"],
  dates: ["تمر", "التمر", "dattes"],
  almonds: ["لوز", "اللوز", "amandes"],
  honey: ["عسل", "العسل", "miel"],
  saffron: ["زعفران", "الزعفران", "safran"],

  // Places / Cuisine types
  marrakech: ["مراكش", "المراكشي", "marrakeshi"],
  fes: ["فاس", "الفاسي", "fassi", "fez"],
  casablanca: ["الدار البيضاء", "كازابلانكا", "casa"],
  tangier: ["طنجة", "الطنجي", "tanger"],
  rabat: ["الرباط", "الرباطي"],

  // Restaurant types
  restaurant: ["مطعم", "المطعم", "resto"],
  cafe: ["مقهى", "قهوة", "coffee", "kahwa"],
  snack: ["سناك", "fast food"],
  riad: ["رياض", "الرياض"],
  rooftop: ["سطح", "terrasse"],
};

/**
 * Reverse lookup: variant -> canonical
 * Built at module load time for O(1) query normalization
 */
const VARIANT_TO_CANONICAL: Map<string, string> = new Map();

// Build reverse lookup map
for (const [canonical, variants] of Object.entries(MOROCCAN_FOOD_TRANSLITERATIONS)) {
  for (const variant of variants) {
    // Store lowercase for case-insensitive matching
    VARIANT_TO_CANONICAL.set(variant.toLowerCase(), canonical);
  }
  // Also map canonical to itself (for consistency)
  VARIANT_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
}

// ============================================================================
// Arabic Text Normalization
// ============================================================================

/**
 * Arabic diacritics (tashkeel) - these are stripped for search
 */
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670]/g;

/**
 * Alef variants that should be normalized to bare alef (ا)
 *
 * - أ (alef with hamza above) -> ا
 * - إ (alef with hamza below) -> ا
 * - آ (alef with madda) -> ا
 * - ٱ (alef wasla) -> ا
 */
const ALEF_VARIANTS_REGEX = /[أإآٱ]/g;
const BARE_ALEF = "ا";

/**
 * Ta marbuta (ة) - can be normalized to ha (ه) or stripped
 * For search purposes, we normalize to ha for broader matching
 */
const TA_MARBUTA = "ة";
const HA = "ه";

/**
 * Normalize Arabic text for search indexing/querying
 *
 * Operations:
 * 1. Remove diacritics (tashkeel)
 * 2. Normalize alef variants to bare alef
 * 3. Normalize ta marbuta to ha
 *
 * @param text - Arabic text to normalize
 * @returns Normalized text
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS_REGEX, "") // Remove diacritics
    .replace(ALEF_VARIANTS_REGEX, BARE_ALEF) // Normalize alef
    .replace(new RegExp(TA_MARBUTA, "g"), HA); // Ta marbuta -> ha
}

// ============================================================================
// Index-Time Expansion
// ============================================================================

/**
 * Check if a term appears as a whole word in text
 * Uses word boundaries for Latin text, substring match for Arabic
 * (Arabic words can have attached prefixes/suffixes)
 */
function containsWholeWord(text: string, term: string): boolean {
  // For Arabic text (contains Arabic Unicode range), use substring matching
  // because Arabic has attached articles/prepositions
  if (/[\u0600-\u06FF]/.test(term)) {
    return text.includes(term);
  }
  // For Latin text, use word boundary matching to avoid false positives
  // like "cafe" in "decaffeinated" or "ras" in "grass"
  const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
  return regex.test(text);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expand text for search indexing
 *
 * When content is created/updated, this function generates searchable text
 * that includes all transliteration variants. This allows users to find
 * content regardless of which language/script they search in.
 *
 * @param text - Original text content
 * @returns Text expanded with all matching variants
 *
 * @example
 * expandForSearch("Best tagine in Marrakech")
 * // Returns: "Best tagine in Marrakech tajine طاجين طجين الطاجين مراكش المراكشي marrakeshi"
 */
export function expandForSearch(text: string): string {
  if (!text) return "";

  const normalizedText = text.toLowerCase();
  const normalizedArabicText = normalizeArabic(normalizedText);
  const expansions: string[] = [];

  // Check each canonical term
  for (const [canonical, variants] of Object.entries(MOROCCAN_FOOD_TRANSLITERATIONS)) {
    // Check if canonical term is in text (whole word match for Latin)
    if (containsWholeWord(normalizedText, canonical)) {
      // Add all variants
      expansions.push(...variants);
    }

    // Also check if any variant is in text (for Arabic source content)
    for (const variant of variants) {
      const normalizedVariant = normalizeArabic(variant.toLowerCase());
      if (
        containsWholeWord(normalizedText, variant.toLowerCase()) ||
        containsWholeWord(normalizedArabicText, normalizedVariant)
      ) {
        // Add canonical and all other variants
        if (!expansions.includes(canonical)) {
          expansions.push(canonical);
        }
        for (const v of variants) {
          if (v !== variant && !expansions.includes(v)) {
            expansions.push(v);
          }
        }
        break; // Found a match, no need to check other variants
      }
    }
  }

  // Return original text plus expansions
  if (expansions.length > 0) {
    return `${text} ${expansions.join(" ")}`;
  }
  return text;
}

// ============================================================================
// Query-Time Normalization
// ============================================================================

/**
 * Normalize a search query
 *
 * Transforms user input to canonical form for matching against indexed content.
 * Handles:
 * - Case normalization
 * - Arabic text normalization
 * - Variant-to-canonical mapping
 *
 * @param query - User's search query
 * @returns Normalized query with variants replaced by canonical forms
 *
 * @example
 * normalizeQuery("tajine مراكش")
 * // Returns: "tagine marrakech"
 */
export function normalizeQuery(query: string): string {
  if (!query) return "";

  // First, normalize Arabic text
  let normalized = normalizeArabic(query.toLowerCase());

  // Split into words for term-by-term normalization
  const words = normalized.split(/\s+/);
  const normalizedWords = words.map((word) => {
    // Look up in variant map
    const canonical = VARIANT_TO_CANONICAL.get(word);
    return canonical || word;
  });

  return normalizedWords.join(" ");
}

/**
 * Extract searchable terms from a query
 *
 * Returns both the normalized query and an array of canonical terms found.
 * Useful for highlighting search results.
 *
 * @param query - User's search query
 * @returns Object with normalized query and matched canonical terms
 */
export function parseSearchQuery(query: string): {
  normalized: string;
  canonicalTerms: string[];
  originalTerms: string[];
} {
  if (!query) {
    return { normalized: "", canonicalTerms: [], originalTerms: [] };
  }

  const originalTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const normalizedArabic = normalizeArabic(query.toLowerCase());
  const words = normalizedArabic.split(/\s+/).filter(Boolean);

  const canonicalTerms: string[] = [];
  const normalizedWords: string[] = [];

  for (const word of words) {
    const canonical = VARIANT_TO_CANONICAL.get(word);
    if (canonical) {
      canonicalTerms.push(canonical);
      normalizedWords.push(canonical);
    } else {
      normalizedWords.push(word);
    }
  }

  return {
    normalized: normalizedWords.join(" "),
    canonicalTerms: [...new Set(canonicalTerms)], // Dedupe
    originalTerms,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a term has transliteration mappings
 */
export function hasTransliterations(term: string): boolean {
  const normalized = term.toLowerCase();
  return (
    normalized in MOROCCAN_FOOD_TRANSLITERATIONS ||
    VARIANT_TO_CANONICAL.has(normalized)
  );
}

/**
 * Get all variants for a term (including the term itself)
 */
export function getVariants(term: string): string[] {
  const normalized = term.toLowerCase();

  // If it's a canonical term, return its variants plus itself
  if (normalized in MOROCCAN_FOOD_TRANSLITERATIONS) {
    return [normalized, ...MOROCCAN_FOOD_TRANSLITERATIONS[normalized]];
  }

  // If it's a variant, get canonical and all variants
  const canonical = VARIANT_TO_CANONICAL.get(normalized);
  if (canonical) {
    return [canonical, ...MOROCCAN_FOOD_TRANSLITERATIONS[canonical]];
  }

  // No mappings found
  return [term];
}

/**
 * Get canonical form of a term
 */
export function getCanonical(term: string): string {
  const normalized = term.toLowerCase();

  // Already canonical?
  if (normalized in MOROCCAN_FOOD_TRANSLITERATIONS) {
    return normalized;
  }

  // Look up variant
  return VARIANT_TO_CANONICAL.get(normalized) || term;
}
