/**
 * Tests for Search - Convex search index functionality
 *
 * Tests the searchable text builders and transliteration integration.
 * Note: Full integration tests with Convex DB would require a test environment.
 */

import { describe, it, expect } from "vitest";

// Import the helper functions from search module
// Since these are also exported from the Convex module, we test the logic directly
import {
  buildCuratedPlaceSearchText,
  buildGuideSearchText,
  buildReviewSearchText,
  buildDishSearchText,
} from "../../convex/search";

describe("Search", () => {
  describe("buildCuratedPlaceSearchText", () => {
    it("should combine all fields into searchable text", () => {
      const place = {
        title: "Best Tagine Restaurant",
        summary: "Traditional Moroccan cuisine in Marrakech",
        mustTry: ["tagine", "couscous"],
        tags: ["traditional", "family-friendly"],
        neighborhood: "Medina",
      };

      const searchText = buildCuratedPlaceSearchText(place);

      // Should contain original content
      expect(searchText).toContain("Best Tagine Restaurant");
      expect(searchText).toContain("Traditional Moroccan cuisine");
      expect(searchText).toContain("Medina");

      // Should contain transliteration variants
      expect(searchText).toContain("tajine"); // French variant of tagine
      expect(searchText).toContain("طاجين"); // Arabic variant
      expect(searchText).toContain("كسكس"); // Arabic for couscous
    });

    it("should handle missing optional fields", () => {
      const place = {
        title: "Simple Cafe",
        summary: "A nice cafe",
      };

      const searchText = buildCuratedPlaceSearchText(place);

      expect(searchText).toContain("Simple Cafe");
      expect(searchText).toContain("A nice cafe");
    });

    it("should expand city names with variants", () => {
      const place = {
        title: "Restaurant in Marrakech",
        summary: "Great food in the heart of Marrakech",
      };

      const searchText = buildCuratedPlaceSearchText(place);

      expect(searchText).toContain("مراكش"); // Arabic for Marrakech
      expect(searchText).toContain("marrakeshi");
    });

    it("should handle Arabic source content", () => {
      const place = {
        title: "مطعم الطاجين",
        summary: "أفضل طاجين في مراكش",
      };

      const searchText = buildCuratedPlaceSearchText(place);

      // Should add English canonical terms
      expect(searchText).toContain("tagine");
      expect(searchText).toContain("marrakech");
    });
  });

  describe("buildGuideSearchText", () => {
    it("should combine title and description", () => {
      const guide = {
        title: "Best Couscous in Fes",
        description: "A guide to finding authentic couscous in the ancient medina",
      };

      const searchText = buildGuideSearchText(guide);

      expect(searchText).toContain("Best Couscous in Fes");
      expect(searchText).toContain("authentic couscous");

      // Should have variants
      expect(searchText).toContain("كسكس"); // Arabic
      expect(searchText).toContain("فاس"); // Arabic for Fes
    });

    it("should expand food terms in descriptions", () => {
      const guide = {
        title: "Morning in Casablanca",
        description: "Start your day with msemen and atay",
      };

      const searchText = buildGuideSearchText(guide);

      // Msemen variants
      expect(searchText).toContain("مسمن");
      expect(searchText).toContain("rghaif");

      // Atay variants
      expect(searchText).toContain("mint tea");
      expect(searchText).toContain("الشاي");
    });
  });

  describe("buildReviewSearchText", () => {
    it("should combine text and dishes tried", () => {
      const review = {
        text: "Amazing tagine, perfectly cooked!",
        dishesTried: ["tagine", "harira"],
      };

      const searchText = buildReviewSearchText(review);

      expect(searchText).toContain("Amazing tagine");
      expect(searchText).toContain("harira");

      // Variants
      expect(searchText).toContain("tajine");
      expect(searchText).toContain("حريرة"); // Arabic harira
    });

    it("should handle review with only text", () => {
      const review = {
        text: "Great pastilla!",
      };

      const searchText = buildReviewSearchText(review);

      expect(searchText).toContain("Great pastilla");
      expect(searchText).toContain("bastilla"); // Alternative spelling
      expect(searchText).toContain("بسطيلة"); // Arabic
    });

    it("should handle review with only dishes", () => {
      const review = {
        dishesTried: ["couscous", "rfissa"],
      };

      const searchText = buildReviewSearchText(review);

      expect(searchText).toContain("couscous");
      expect(searchText).toContain("rfissa");
      expect(searchText).toContain("رفيسة"); // Arabic rfissa
    });

    it("should handle empty review", () => {
      const review = {};

      const searchText = buildReviewSearchText(review);

      expect(searchText).toBe("");
    });
  });

  describe("buildDishSearchText", () => {
    it("should expand dish name with variants", () => {
      const searchText = buildDishSearchText("tagine");

      expect(searchText).toContain("tagine");
      expect(searchText).toContain("tajine");
      expect(searchText).toContain("طاجين");
      expect(searchText).toContain("طجين");
    });

    it("should expand Arabic dish names", () => {
      const searchText = buildDishSearchText("بسطيلة");

      expect(searchText).toContain("pastilla");
      expect(searchText).toContain("bastilla");
      expect(searchText).toContain("bestilla");
    });

    it("should return original for unknown dishes", () => {
      const searchText = buildDishSearchText("pizza");

      expect(searchText).toBe("pizza");
    });
  });

  describe("Cross-script search scenarios", () => {
    it("English query should find Arabic content", () => {
      // Simulate: curated place has Arabic title, user searches English
      const arabicPlace = {
        title: "مطعم الطاجين الذهبي",
        summary: "أفضل طاجين في المدينة",
      };

      const searchText = buildCuratedPlaceSearchText(arabicPlace);

      // English search terms should be in the expanded text
      expect(searchText.toLowerCase()).toContain("tagine");
    });

    it("Arabic query should find English content", () => {
      // Simulate: guide has English title, user searches Arabic
      const englishGuide = {
        title: "Best Tagine Restaurants",
        description: "Top picks for tagine in Marrakech",
      };

      const searchText = buildGuideSearchText(englishGuide);

      // Arabic variants should be in the expanded text
      expect(searchText).toContain("طاجين");
      expect(searchText).toContain("مراكش");
    });

    it("French query should find content", () => {
      // Simulate: user searches "tajine" (French spelling)
      const place = {
        title: "Tagine House",
        summary: "Authentic tagine experience",
      };

      const searchText = buildCuratedPlaceSearchText(place);

      // French variant should be in the expanded text
      expect(searchText).toContain("tajine");
    });

    it("Mixed language content should be fully searchable", () => {
      const place = {
        title: "Le Restaurant - المطعم",
        summary: "Traditional tagine and couscous - طاجين وكسكس",
        mustTry: ["tagine", "كسكس"],
      };

      const searchText = buildCuratedPlaceSearchText(place);

      // All variants should be present
      expect(searchText).toContain("tagine");
      expect(searchText).toContain("tajine");
      expect(searchText).toContain("طاجين");
      expect(searchText).toContain("couscous");
      expect(searchText).toContain("كسكس");
      expect(searchText).toContain("restaurant");
      expect(searchText).toContain("مطعم");
    });
  });
});
