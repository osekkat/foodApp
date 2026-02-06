import { describe, expect, it } from "vitest";

import {
  normalizeMapSearchQuery,
  shouldAutoExecuteUrlSearch,
  shouldMarkAutoSearchedOnSubmit,
} from "@/lib/mapSearchFlow";

describe("mapSearchFlow", () => {
  describe("normalizeMapSearchQuery", () => {
    it("uses trimmed explicit query when provided", () => {
      expect(normalizeMapSearchQuery("  tagine  ", "restaurants")).toBe("tagine");
    });

    it("falls back to trimmed default query when explicit query is blank", () => {
      expect(normalizeMapSearchQuery("   ", "  cafes  ")).toBe("cafes");
    });

    it("falls back to hard default when both are blank", () => {
      expect(normalizeMapSearchQuery("   ", "   ")).toBe("restaurant");
    });
  });

  describe("shouldAutoExecuteUrlSearch", () => {
    it("returns true when URL query exists and search can run", () => {
      expect(
        shouldAutoExecuteUrlSearch({
          hasAutoSearched: false,
          hasSearchBounds: true,
          isOnCooldown: false,
          urlQuery: "restaurants",
        }),
      ).toBe(true);
    });

    it("returns false when already auto-searched", () => {
      expect(
        shouldAutoExecuteUrlSearch({
          hasAutoSearched: true,
          hasSearchBounds: true,
          isOnCooldown: false,
          urlQuery: "restaurants",
        }),
      ).toBe(false);
    });

    it("returns false when search bounds are unavailable", () => {
      expect(
        shouldAutoExecuteUrlSearch({
          hasAutoSearched: false,
          hasSearchBounds: false,
          isOnCooldown: false,
          urlQuery: "restaurants",
        }),
      ).toBe(false);
    });

    it("returns false while on cooldown", () => {
      expect(
        shouldAutoExecuteUrlSearch({
          hasAutoSearched: false,
          hasSearchBounds: true,
          isOnCooldown: true,
          urlQuery: "restaurants",
        }),
      ).toBe(false);
    });

    it("returns false when URL query is empty/whitespace", () => {
      expect(
        shouldAutoExecuteUrlSearch({
          hasAutoSearched: false,
          hasSearchBounds: true,
          isOnCooldown: false,
          urlQuery: "   ",
        }),
      ).toBe(false);
    });
  });

  describe("shouldMarkAutoSearchedOnSubmit", () => {
    it("returns true when bounds exist and not on cooldown", () => {
      expect(
        shouldMarkAutoSearchedOnSubmit({
          hasSearchBounds: true,
          isOnCooldown: false,
        }),
      ).toBe(true);
    });

    it("returns false when bounds are missing", () => {
      expect(
        shouldMarkAutoSearchedOnSubmit({
          hasSearchBounds: false,
          isOnCooldown: false,
        }),
      ).toBe(false);
    });

    it("returns false when on cooldown", () => {
      expect(
        shouldMarkAutoSearchedOnSubmit({
          hasSearchBounds: true,
          isOnCooldown: true,
        }),
      ).toBe(false);
    });
  });
});
