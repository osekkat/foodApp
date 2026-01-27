/**
 * Compliance Tests for Analytics Event Redaction
 *
 * Policy: Analytics events must use placeKey only - never provider content.
 * This prevents accidental PII/provider data from being sent to analytics platforms.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * Fields that are FORBIDDEN in analytics events
 * These contain provider content that must not be tracked
 */
const FORBIDDEN_ANALYTICS_FIELDS = [
  "displayName",
  "name", // Alias that might be used
  "formattedAddress",
  "address",
  "nationalPhoneNumber",
  "phone",
  "websiteUri",
  "website",
  "rating", // Provider rating
  "userRatingCount",
  "reviews",
  "priceLevel",
  "regularOpeningHours",
  "hours",
  "photos",
] as const;

/**
 * Fields that ARE ALLOWED in analytics events
 * These are safe identifiers and owned metrics
 */
const ALLOWED_ANALYTICS_FIELDS = [
  "placeKey", // Our canonical identifier
  "eventType",
  "timestamp",
  "userId", // Hashed user ID if tracking
  "sessionId",
  "city",
  "locale",
  "serviceMode", // Our service mode (0-3)
  "communityRating", // OUR aggregate, not provider's
  "favoritesCount", // Our count
  "searchQuery", // User's query (their input, not provider data)
  "resultCount",
  "latencyMs",
  "cacheHit",
] as const;

/**
 * Mock analytics tracker for testing
 */
class MockAnalyticsTracker {
  events: Array<{ type: string; properties: Record<string, unknown> }> = [];

  track(eventType: string, properties: Record<string, unknown>) {
    this.events.push({ type: eventType, properties });
  }

  clear() {
    this.events = [];
  }

  getEvents() {
    return this.events;
  }
}

/**
 * Validates that an analytics event contains no forbidden fields
 */
function validateAnalyticsEvent(
  event: { type: string; properties: Record<string, unknown> },
  forbiddenFields: readonly string[]
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  function checkObject(obj: unknown, path: string = "") {
    if (obj === null || obj === undefined) return;

    if (typeof obj === "object") {
      Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;

        // Check if the key itself is forbidden
        if (forbiddenFields.includes(key)) {
          violations.push(`Forbidden field "${currentPath}" found in event`);
        }

        // Check if the value contains provider content (string matching)
        if (typeof value === "string" && value.length > 0) {
          // Check for patterns that look like addresses, phone numbers, etc.
          if (
            key === "address" ||
            key === "formattedAddress" ||
            /^\+?\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,4}$/.test(
              value
            )
          ) {
            if (!forbiddenFields.includes(key)) {
              // It's a field name we don't explicitly forbid, but check the value
            }
          }
        }

        // Recursively check nested objects
        if (typeof value === "object" && value !== null) {
          checkObject(value, currentPath);
        }
      });
    }
  }

  checkObject(event.properties);

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Example compliant analytics event builder
 * This shows the CORRECT way to build analytics events
 */
function buildPlaceViewEvent(
  placeKey: string,
  metadata: {
    city?: string;
    serviceMode?: number;
    cacheHit?: boolean;
    latencyMs?: number;
  }
): { type: string; properties: Record<string, unknown> } {
  return {
    type: "place_view",
    properties: {
      placeKey, // ONLY the placeKey, never the place name
      city: metadata.city,
      serviceMode: metadata.serviceMode,
      cacheHit: metadata.cacheHit,
      latencyMs: metadata.latencyMs,
      timestamp: Date.now(),
    },
  };
}

/**
 * Example NON-COMPLIANT analytics event (for testing detection)
 */
function buildNonCompliantEvent(): {
  type: string;
  properties: Record<string, unknown>;
} {
  return {
    type: "place_view",
    properties: {
      placeKey: "g:ChIJ123abc",
      displayName: "Cafe Clock", // FORBIDDEN
      formattedAddress: "123 Medina", // FORBIDDEN
      rating: 4.5, // FORBIDDEN
    },
  };
}

describe("Analytics Event Redaction Compliance", () => {
  let tracker: MockAnalyticsTracker;

  beforeEach(() => {
    tracker = new MockAnalyticsTracker();
  });

  afterEach(() => {
    tracker.clear();
  });

  describe("Event validation function", () => {
    it("should detect forbidden displayName field", () => {
      const event = {
        type: "test",
        properties: {
          placeKey: "g:123",
          displayName: "Test Cafe", // FORBIDDEN
        },
      };

      const result = validateAnalyticsEvent(event, FORBIDDEN_ANALYTICS_FIELDS);

      expect(result.valid).toBe(false);
      expect(result.violations).toContain(
        'Forbidden field "displayName" found in event'
      );
    });

    it("should detect forbidden formattedAddress field", () => {
      const event = {
        type: "test",
        properties: {
          placeKey: "g:123",
          formattedAddress: "123 Test St", // FORBIDDEN
        },
      };

      const result = validateAnalyticsEvent(event, FORBIDDEN_ANALYTICS_FIELDS);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("formattedAddress"))).toBe(
        true
      );
    });

    it("should detect multiple forbidden fields", () => {
      const event = buildNonCompliantEvent();
      const result = validateAnalyticsEvent(event, FORBIDDEN_ANALYTICS_FIELDS);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(3); // displayName, formattedAddress, rating
    });

    it("should pass for compliant events", () => {
      const event = buildPlaceViewEvent("g:ChIJ123abc", {
        city: "marrakech",
        serviceMode: 0,
        cacheHit: true,
        latencyMs: 150,
      });

      const result = validateAnalyticsEvent(event, FORBIDDEN_ANALYTICS_FIELDS);

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should detect nested forbidden fields", () => {
      const event = {
        type: "test",
        properties: {
          placeKey: "g:123",
          place: {
            displayName: "Hidden Cafe", // FORBIDDEN (nested)
          },
        },
      };

      const result = validateAnalyticsEvent(event, FORBIDDEN_ANALYTICS_FIELDS);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("displayName"))).toBe(true);
    });
  });

  describe("Compliant event building", () => {
    it("should build place_view events with only placeKey", () => {
      const event = buildPlaceViewEvent("g:ChIJ123abc", { city: "marrakech" });

      // Verify placeKey is present
      expect(event.properties.placeKey).toBe("g:ChIJ123abc");

      // Verify no forbidden fields
      FORBIDDEN_ANALYTICS_FIELDS.forEach((field) => {
        expect(event.properties).not.toHaveProperty(field);
      });
    });

    it("should not include name aliases", () => {
      const event = buildPlaceViewEvent("g:ChIJ123abc", {});

      expect(event.properties).not.toHaveProperty("name");
      expect(event.properties).not.toHaveProperty("displayName");
      expect(event.properties).not.toHaveProperty("title");
    });
  });

  describe("Search event compliance", () => {
    it("should track search queries without place names in results", () => {
      const searchEvent = {
        type: "search",
        properties: {
          query: "best tagine marrakech", // User input is OK
          resultCount: 10,
          placeKeys: ["g:ChIJ1", "g:ChIJ2", "g:ChIJ3"], // IDs only
          latencyMs: 250,
          cacheHit: false,
        },
      };

      const result = validateAnalyticsEvent(searchEvent, FORBIDDEN_ANALYTICS_FIELDS);
      expect(result.valid).toBe(true);
    });

    it("should reject search events with place names", () => {
      const badSearchEvent = {
        type: "search",
        properties: {
          query: "best tagine",
          results: [
            { placeKey: "g:123", displayName: "Cafe A" }, // FORBIDDEN
            { placeKey: "g:456", displayName: "Restaurant B" }, // FORBIDDEN
          ],
        },
      };

      const result = validateAnalyticsEvent(badSearchEvent, FORBIDDEN_ANALYTICS_FIELDS);
      expect(result.valid).toBe(false);
    });
  });

  describe("Review event compliance", () => {
    it("should track review submissions with placeKey only", () => {
      const reviewEvent = {
        type: "review_submit",
        properties: {
          placeKey: "g:ChIJ123abc",
          rating: 4, // THIS IS USER'S RATING, not provider's - ALLOWED
          hasText: true,
          hasPhotos: false,
          dishesTriedCount: 2,
        },
      };

      // Note: "rating" here is the user's OWN rating, not provider's
      // We need custom validation for this case
      const result = validateAnalyticsEvent(
        reviewEvent,
        FORBIDDEN_ANALYTICS_FIELDS.filter((f) => f !== "rating")
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("List event compliance", () => {
    it("should track list add events without place details", () => {
      const listEvent = {
        type: "list_add",
        properties: {
          listId: "list_123",
          placeKey: "g:ChIJ123abc",
          listType: "favorites",
        },
      };

      const result = validateAnalyticsEvent(listEvent, FORBIDDEN_ANALYTICS_FIELDS);
      expect(result.valid).toBe(true);
    });
  });
});

describe("Analytics Configuration Compliance", () => {
  it("should have a deny-list of fields that must never be tracked", () => {
    // Verify our forbidden list includes critical provider fields
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("displayName");
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("formattedAddress");
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("nationalPhoneNumber");
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("websiteUri");
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("reviews");
  });

  it("should have placeKey as an allowed tracking field", () => {
    expect(ALLOWED_ANALYTICS_FIELDS).toContain("placeKey");
  });

  it("should distinguish between provider rating and community rating", () => {
    // Provider's rating is forbidden
    expect(FORBIDDEN_ANALYTICS_FIELDS).toContain("rating");

    // Our community rating IS allowed
    expect(ALLOWED_ANALYTICS_FIELDS).toContain("communityRating");
  });
});
