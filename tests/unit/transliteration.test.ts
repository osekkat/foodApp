/**
 * Tests for Transliteration - Arabic/French/English Search Normalization
 *
 * Verifies:
 * - Mapping table coverage
 * - Arabic text normalization
 * - Index-time expansion
 * - Query-time normalization
 * - Cross-script matching
 */

import { describe, it, expect } from "vitest";
import {
  MOROCCAN_FOOD_TRANSLITERATIONS,
  normalizeArabic,
  expandForSearch,
  normalizeQuery,
  parseSearchQuery,
  hasTransliterations,
  getVariants,
  getCanonical,
} from "../../lib/transliteration";

describe("Transliteration", () => {
  describe("MOROCCAN_FOOD_TRANSLITERATIONS mapping table", () => {
    it("should have entries for common Moroccan dishes", () => {
      // Essential dishes that must be in the mapping
      const essentialDishes = [
        "tagine",
        "couscous",
        "pastilla",
        "harira",
        "msemen",
        "baghrir",
        "rfissa",
        "kefta",
        "briouates",
      ];

      for (const dish of essentialDishes) {
        expect(MOROCCAN_FOOD_TRANSLITERATIONS).toHaveProperty(dish);
        expect(MOROCCAN_FOOD_TRANSLITERATIONS[dish].length).toBeGreaterThan(0);
      }
    });

    it("should include Arabic variants for major dishes", () => {
      // Check that key dishes have Arabic variants
      const tagineVariants = MOROCCAN_FOOD_TRANSLITERATIONS.tagine;
      expect(tagineVariants.some((v) => /[\u0600-\u06FF]/.test(v))).toBe(true);

      const couscousVariants = MOROCCAN_FOOD_TRANSLITERATIONS.couscous;
      expect(couscousVariants.some((v) => /[\u0600-\u06FF]/.test(v))).toBe(true);
    });

    it("should include French variants where applicable", () => {
      // 'tajine' is the French spelling of 'tagine'
      expect(MOROCCAN_FOOD_TRANSLITERATIONS.tagine).toContain("tajine");

      // 'bastilla' is alternate spelling
      expect(MOROCCAN_FOOD_TRANSLITERATIONS.pastilla).toContain("bastilla");
    });

    it("should include city/location variants", () => {
      expect(MOROCCAN_FOOD_TRANSLITERATIONS).toHaveProperty("marrakech");
      expect(MOROCCAN_FOOD_TRANSLITERATIONS).toHaveProperty("fes");
      expect(MOROCCAN_FOOD_TRANSLITERATIONS).toHaveProperty("casablanca");
    });
  });

  describe("normalizeArabic", () => {
    it("should remove diacritics (tashkeel)", () => {
      // Arabic text with diacritics: طَاجِين (with fatha, kasra)
      const withDiacritics = "طَاجِين";
      const normalized = normalizeArabic(withDiacritics);

      // Should not contain diacritic characters
      expect(normalized).not.toMatch(/[\u064B-\u065F\u0670]/);
    });

    it("should normalize alef variants to bare alef", () => {
      // أ (alef with hamza above)
      expect(normalizeArabic("أكل")).toBe("اكل");

      // إ (alef with hamza below)
      expect(normalizeArabic("إبراهيم")).toBe("ابراهيم");

      // آ (alef with madda) - becomes single alef for search
      expect(normalizeArabic("آكل")).toBe("اكل");
    });

    it("should normalize ta marbuta to ha", () => {
      // حريرة -> حريره
      expect(normalizeArabic("حريرة")).toBe("حريره");

      // بسطيلة -> بسطيله
      expect(normalizeArabic("بسطيلة")).toBe("بسطيله");
    });

    it("should handle mixed content", () => {
      const mixed = "Best طَاجِين in مَرَّاكِش";
      const normalized = normalizeArabic(mixed);

      // Diacritics should be removed
      expect(normalized).not.toMatch(/[\u064B-\u065F]/);
    });

    it("should not modify non-Arabic text", () => {
      expect(normalizeArabic("hello world")).toBe("hello world");
      expect(normalizeArabic("tagine")).toBe("tagine");
    });
  });

  describe("expandForSearch (index-time)", () => {
    it("should expand canonical terms with variants", () => {
      const expanded = expandForSearch("Best tagine in town");

      // Should contain original text
      expect(expanded).toContain("Best tagine in town");

      // Should contain French variant
      expect(expanded).toContain("tajine");

      // Should contain Arabic variant
      expect(expanded).toContain("طاجين");
    });

    it("should expand multiple terms", () => {
      const expanded = expandForSearch("tagine and couscous");

      expect(expanded).toContain("tajine");
      expect(expanded).toContain("طاجين");
      expect(expanded).toContain("كسكس");
    });

    it("should expand Arabic source content", () => {
      const expanded = expandForSearch("أفضل طاجين في المدينة");

      // Should add English canonical
      expect(expanded).toContain("tagine");

      // Should add French variant
      expect(expanded).toContain("tajine");
    });

    it("should handle content with city names", () => {
      const expanded = expandForSearch("Best restaurant in Marrakech");

      expect(expanded).toContain("مراكش");
      expect(expanded).toContain("marrakeshi");
    });

    it("should return original text if no matches", () => {
      const text = "Hello world";
      expect(expandForSearch(text)).toBe(text);
    });

    it("should handle empty input", () => {
      expect(expandForSearch("")).toBe("");
      expect(expandForSearch(null as unknown as string)).toBe("");
    });
  });

  describe("normalizeQuery (query-time)", () => {
    it("should convert French variant to canonical", () => {
      expect(normalizeQuery("tajine")).toBe("tagine");
    });

    it("should convert Arabic to canonical", () => {
      expect(normalizeQuery("طاجين")).toBe("tagine");
    });

    it("should handle mixed language queries", () => {
      const normalized = normalizeQuery("tajine مراكش");
      expect(normalized).toBe("tagine marrakech");
    });

    it("should preserve unknown terms", () => {
      const normalized = normalizeQuery("tajine xyz unknown");
      expect(normalized).toContain("tagine");
      expect(normalized).toContain("xyz");
      expect(normalized).toContain("unknown");
    });

    it("should be case-insensitive", () => {
      expect(normalizeQuery("TAJINE")).toBe("tagine");
      expect(normalizeQuery("Tajine")).toBe("tagine");
    });

    it("should handle empty input", () => {
      expect(normalizeQuery("")).toBe("");
    });
  });

  describe("parseSearchQuery", () => {
    it("should return normalized query and canonical terms", () => {
      const result = parseSearchQuery("tajine مراكش");

      expect(result.normalized).toBe("tagine marrakech");
      expect(result.canonicalTerms).toContain("tagine");
      expect(result.canonicalTerms).toContain("marrakech");
    });

    it("should deduplicate canonical terms", () => {
      // Both 'tajine' and 'طاجين' map to 'tagine'
      const result = parseSearchQuery("tajine طاجين");

      expect(result.canonicalTerms.filter((t) => t === "tagine")).toHaveLength(1);
    });

    it("should track original terms", () => {
      const result = parseSearchQuery("tajine مراكش unknown");

      expect(result.originalTerms).toContain("tajine");
      expect(result.originalTerms).toContain("مراكش");
      expect(result.originalTerms).toContain("unknown");
    });
  });

  describe("Cross-script matching scenarios", () => {
    it("should match English query against Arabic content", () => {
      // Simulate: content has Arabic, user searches English
      const contentExpanded = expandForSearch("أفضل طاجين في مراكش");
      const queryNormalized = normalizeQuery("tagine marrakech");

      // Both 'tagine' and 'marrakech' should be in expanded content
      for (const term of queryNormalized.split(" ")) {
        expect(contentExpanded.toLowerCase()).toContain(term);
      }
    });

    it("should match Arabic query against English content", () => {
      // Simulate: content has English, user searches Arabic
      const contentExpanded = expandForSearch("Best tagine in Marrakech");
      const query = "طاجين مراكش";

      // Normalize query to canonical
      const queryNormalized = normalizeQuery(query);

      // Canonical terms should be in expanded content
      expect(contentExpanded.toLowerCase()).toContain("tagine");
      expect(contentExpanded.toLowerCase()).toContain("marrakech");
      expect(queryNormalized).toContain("tagine");
      expect(queryNormalized).toContain("marrakech");
    });

    it("should match French query against Arabic content", () => {
      const contentExpanded = expandForSearch("طاجين لحم");
      const queryNormalized = normalizeQuery("tajine");

      expect(queryNormalized).toBe("tagine");
      expect(contentExpanded).toContain("tagine");
    });

    it("should handle real-world search scenario", () => {
      // Place has Arabic title
      const placeTitle = "مطعم الطاجين الذهبي";
      const expandedTitle = expandForSearch(placeTitle);

      // User searches in English
      const userQuery = "tagine restaurant";
      const normalizedQuery = normalizeQuery(userQuery);

      // Verify match would work
      const queryTerms = normalizedQuery.split(" ");
      let matchCount = 0;
      for (const term of queryTerms) {
        if (expandedTitle.toLowerCase().includes(term)) {
          matchCount++;
        }
      }

      // At least 'tagine' should match
      expect(matchCount).toBeGreaterThan(0);
    });
  });

  describe("hasTransliterations", () => {
    it("should return true for canonical terms", () => {
      expect(hasTransliterations("tagine")).toBe(true);
      expect(hasTransliterations("couscous")).toBe(true);
    });

    it("should return true for variants", () => {
      expect(hasTransliterations("tajine")).toBe(true);
      expect(hasTransliterations("طاجين")).toBe(true);
    });

    it("should return false for unknown terms", () => {
      expect(hasTransliterations("xyz")).toBe(false);
      expect(hasTransliterations("hamburger")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(hasTransliterations("TAGINE")).toBe(true);
      expect(hasTransliterations("Tajine")).toBe(true);
    });
  });

  describe("getVariants", () => {
    it("should return all variants for canonical term", () => {
      const variants = getVariants("tagine");

      expect(variants).toContain("tagine");
      expect(variants).toContain("tajine");
      expect(variants).toContain("طاجين");
    });

    it("should return all variants for variant term", () => {
      const variants = getVariants("tajine");

      expect(variants).toContain("tagine");
      expect(variants).toContain("tajine");
      expect(variants).toContain("طاجين");
    });

    it("should return only the term itself for unknowns", () => {
      const variants = getVariants("unknown");
      expect(variants).toEqual(["unknown"]);
    });
  });

  describe("getCanonical", () => {
    it("should return canonical for variants", () => {
      expect(getCanonical("tajine")).toBe("tagine");
      expect(getCanonical("طاجين")).toBe("tagine");
    });

    it("should return same for canonical terms", () => {
      expect(getCanonical("tagine")).toBe("tagine");
    });

    it("should return input for unknown terms", () => {
      expect(getCanonical("unknown")).toBe("unknown");
    });
  });
});
