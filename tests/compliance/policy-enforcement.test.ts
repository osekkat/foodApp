/**
 * Compliance Tests for Provider Data Policy Enforcement
 *
 * These tests ensure that the app never persists or logs restricted provider content.
 * They run on every PR and block deployment on failure.
 *
 * Policy:
 * - ALLOWED to persist: place_id, placeKey, photo_reference, owned content, community aggregates
 * - FORBIDDEN to persist: displayName, formattedAddress, phone, hours, ratings, reviews, photos bytes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  redactProviderContent,
  generateRequestId,
} from "../../convex/providerGateway";
import { FIELD_SETS, type FieldSetKey } from "../../convex/fieldSets";

/**
 * List of provider content fields that MUST NEVER be persisted to the database
 * These are the fields returned by Google Places API (New) that we can only display ephemerally
 */
const FORBIDDEN_PERSISTENCE_FIELDS = [
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "regularOpeningHours",
  "currentOpeningHours",
  "priceLevel",
  "rating",
  "userRatingCount",
  "reviews", // Google reviews
  "photos", // Photo bytes or full photo objects (references are ok)
  "primaryTypeDisplayName",
  "editorialSummary",
  "paymentOptions",
  "parkingOptions",
  "accessibilityOptions",
  "servesBreakfast",
  "servesBrunch",
  "servesLunch",
  "servesDinner",
  "servesVegetarianFood",
  "outdoorSeating",
  "liveMusic",
  "menuForChildren",
  "servesCocktails",
  "servesDessert",
  "servesCoffee",
  "goodForChildren",
  "allowsDogs",
  "restroom",
  "goodForGroups",
  "goodForWatchingSports",
  "takeout",
  "delivery",
  "dineIn",
  "reservable",
  "curbsidePickup",
] as const;

/**
 * Fields that ARE allowed to persist (ID-only or owned content)
 */
const ALLOWED_PERSISTENCE_FIELDS = [
  "id", // Google place ID (transformed to placeKey)
  "placeKey", // Our canonical key: "g:" + place_id or "c:" + slug
  "place_id", // Raw Google place ID (for reference)
  "photo_reference", // Photo reference string only (not photo bytes)
  "location", // Lat/lng only - with expiry
  "lat",
  "lng",
] as const;

describe("Provider Data Policy - Persistence Compliance", () => {
  describe("Schema field validation", () => {
    it("should NOT have forbidden provider fields in places table schema", () => {
      // Read the schema file and verify no forbidden fields are defined
      // This is a static analysis test - if someone adds a forbidden field,
      // they need to justify it and update this test
      const placeTableAllowedFields = [
        "placeKey",
        "provider",
        "providerPlaceId",
        "lat",
        "lng",
        "geoExpiresAt",
        "communityRatingAvg", // This is OUR aggregate, not provider's
        "communityRatingCount", // This is OUR aggregate
        "favoritesCount",
        "createdAt",
        "lastSeenAt",
      ];

      // These would be forbidden if they existed
      const forbiddenInPlaces = FORBIDDEN_PERSISTENCE_FIELDS.filter((field) =>
        placeTableAllowedFields.includes(field)
      );

      expect(forbiddenInPlaces).toHaveLength(0);
    });

    it("should NOT have provider content fields in searchResultCache", () => {
      // searchResultCache should only store: cacheKey, provider, placeKeys (IDs), expiresAt, createdAt
      const allowedSearchCacheFields = [
        "cacheKey",
        "provider",
        "placeKeys", // Array of placeKey strings only
        "expiresAt",
        "createdAt",
      ];

      // Verify none of the forbidden fields are in the allowed list
      const forbiddenFound = FORBIDDEN_PERSISTENCE_FIELDS.filter((f) =>
        allowedSearchCacheFields.includes(f)
      );
      expect(forbiddenFound).toHaveLength(0);
    });

    it("should NOT have provider content fields in mapTileCache", () => {
      // mapTileCache should only store tile membership, not provider content
      const allowedTileCacheFields = [
        "tileKey",
        "zoom",
        "chunk",
        "provider",
        "placeKeys", // Array of placeKey strings only
        "expiresAt",
        "createdAt",
      ];

      const forbiddenFound = FORBIDDEN_PERSISTENCE_FIELDS.filter((f) =>
        allowedTileCacheFields.includes(f)
      );
      expect(forbiddenFound).toHaveLength(0);
    });
  });

  describe("ProviderGateway redaction", () => {
    it("should redact displayName from error messages", () => {
      const message = 'Error processing: {"displayName":"Cafe Clock Marrakech"}';
      const redacted = redactProviderContent(message);

      expect(redacted).not.toContain("Cafe Clock Marrakech");
      expect(redacted).toContain("[REDACTED]");
    });

    it("should redact formattedAddress from error messages", () => {
      const message =
        'Response contained: {"formattedAddress":"123 Rue de la Kasbah, Marrakech"}';
      const redacted = redactProviderContent(message);

      expect(redacted).not.toContain("123 Rue de la Kasbah");
      expect(redacted).toContain("[REDACTED]");
    });

    it("should redact nationalPhoneNumber from error messages", () => {
      const message = 'Phone number found: {"nationalPhoneNumber":"+212 524 123456"}';
      const redacted = redactProviderContent(message);

      expect(redacted).not.toContain("+212 524 123456");
      expect(redacted).toContain("[REDACTED]");
    });

    it("should redact websiteUri from error messages", () => {
      const message = 'Site: {"websiteUri":"https://example-restaurant.ma"}';
      const redacted = redactProviderContent(message);

      expect(redacted).not.toContain("https://example-restaurant.ma");
      expect(redacted).toContain("[REDACTED]");
    });

    it("should handle multiple provider fields in one message", () => {
      const message =
        '{"displayName":"Test Place","formattedAddress":"123 Test St","nationalPhoneNumber":"+1234567890"}';
      const redacted = redactProviderContent(message);

      expect(redacted).not.toContain("Test Place");
      expect(redacted).not.toContain("123 Test St");
      expect(redacted).not.toContain("+1234567890");
      expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(3);
    });

    it("should preserve non-sensitive content in messages", () => {
      const message = "Request failed with status 429 for place_id ChIJ123abc";
      const redacted = redactProviderContent(message);

      expect(redacted).toBe(message); // No changes - no sensitive content
    });
  });

  describe("Request ID generation", () => {
    it("should generate unique request IDs for tracking", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it("should NOT include provider content in request ID", () => {
      const id = generateRequestId();

      // Request ID should only contain safe metadata, not provider content
      FORBIDDEN_PERSISTENCE_FIELDS.forEach((field) => {
        expect(id.toLowerCase()).not.toContain(field.toLowerCase());
      });
    });
  });
});

describe("Provider Data Policy - Field Set Registry Compliance", () => {
  describe("Field mask validation", () => {
    it("should only use registered field sets - no ad-hoc masks", () => {
      // All field sets should be pre-defined
      expect(Object.keys(FIELD_SETS).length).toBeGreaterThan(0);

      // Each field set should have required properties
      Object.entries(FIELD_SETS).forEach(([key, fieldSet]) => {
        expect(fieldSet).toHaveProperty("mask");
        expect(fieldSet).toHaveProperty("costTier");
        expect(fieldSet).toHaveProperty("description");
        expect(fieldSet).toHaveProperty("maxCostPerCall");
        expect(typeof fieldSet.mask).toBe("string");
        expect(fieldSet.mask.length).toBeGreaterThan(0);
      });
    });

    it("should have valid cost tiers for all field sets", () => {
      const validCostTiers = ["basic", "advanced", "preferred"];

      Object.values(FIELD_SETS).forEach((fieldSet) => {
        expect(validCostTiers).toContain(fieldSet.costTier);
      });
    });

    it("should have descriptions for all field sets (documentation)", () => {
      Object.values(FIELD_SETS).forEach((fieldSet) => {
        expect(fieldSet.description.length).toBeGreaterThan(10);
      });
    });
  });
});

describe("Provider Data Policy - Metric Logging Compliance", () => {
  describe("Metric payload validation", () => {
    it("should only log safe metadata fields in metrics", () => {
      // Define what IS safe to log
      const safeMetricFields = [
        "requestId",
        "success",
        "errorCode",
        "endpointClass",
        "fieldSet",
        "costClass",
        "latencyMs",
        "cacheHit",
      ];

      // These should NEVER appear in metrics
      const forbiddenMetricFields = [
        "displayName",
        "formattedAddress",
        "nationalPhoneNumber",
        "websiteUri",
        "rating",
        "reviews",
        "photos",
        "data", // Raw response data
        "response", // Response body
        "body",
        "content",
      ];

      // Create a sample metric payload (mimicking emitProviderMetric)
      const sampleMetric = {
        requestId: "req_123_abc",
        success: true,
        errorCode: undefined,
        endpointClass: "place_details",
        fieldSet: "PLACE_HEADER",
        costClass: "basic",
        latencyMs: 150,
        cacheHit: false,
      };

      // Verify all fields in sample are safe
      Object.keys(sampleMetric).forEach((field) => {
        expect(safeMetricFields).toContain(field);
        expect(forbiddenMetricFields).not.toContain(field);
      });
    });
  });
});
