/**
 * Compliance Tests for Sentry Error Tracking Redaction
 *
 * Policy: Sentry events must NEVER contain provider content.
 * The beforeSend hook must scrub any provider data before transmission.
 *
 * This prevents:
 * - Provider content from being logged in error reports
 * - Place names, addresses, etc. from appearing in Sentry dashboard
 * - Compliance violations through error tracking
 */

import { describe, it, expect, vi } from "vitest";

/**
 * Provider content fields that must be scrubbed from Sentry events
 */
const SENTRY_SCRUB_FIELDS = [
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
  "currentOpeningHours",
  "reviews",
  "photos",
  "editorialSummary",
  "rating",
  "userRatingCount",
  "priceLevel",
] as const;

/**
 * Fields that ARE safe to include in Sentry events
 */
const SENTRY_SAFE_FIELDS = [
  "placeKey",
  "provider",
  "endpointClass",
  "fieldSet",
  "requestId",
  "errorCode",
  "latencyMs",
  "serviceMode",
  "userId", // Hashed/anonymized
  "sessionId",
] as const;

/**
 * Mock Sentry event structure
 */
interface MockSentryEvent {
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: unknown[] };
    }>;
  };
  message?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, string>;
  breadcrumbs?: Array<{
    category?: string;
    message?: string;
    data?: Record<string, unknown>;
  }>;
}

/**
 * Sentry beforeSend hook that scrubs provider content
 * This is the reference implementation for testing
 */
function sentryBeforeSend(
  event: MockSentryEvent
): MockSentryEvent | null {
  // Deep clone to avoid mutating original
  const scrubbed = JSON.parse(JSON.stringify(event)) as MockSentryEvent;

  // Scrub function for objects
  function scrubObject(obj: unknown, depth: number = 0): unknown {
    if (depth > 10) return obj; // Prevent infinite recursion
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => scrubObject(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Check if this key should be scrubbed
      if (SENTRY_SCRUB_FIELDS.includes(key as typeof SENTRY_SCRUB_FIELDS[number])) {
        result[key] = "[REDACTED_PROVIDER_CONTENT]";
      } else if (typeof value === "object" && value !== null) {
        result[key] = scrubObject(value, depth + 1);
      } else if (typeof value === "string") {
        // Additional scrubbing for values that look like provider content
        result[key] = scrubStringValue(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // Scrub string values that might contain provider content
  function scrubStringValue(value: string): string {
    // Redact JSON-like content that might contain provider data
    let scrubbed = value;

    // Redact displayName values
    scrubbed = scrubbed.replace(
      /"displayName"\s*:\s*"[^"]*"/g,
      '"displayName":"[REDACTED]"'
    );

    // Redact formattedAddress values
    scrubbed = scrubbed.replace(
      /"formattedAddress"\s*:\s*"[^"]*"/g,
      '"formattedAddress":"[REDACTED]"'
    );

    // Redact phone numbers
    scrubbed = scrubbed.replace(
      /"(?:nationalPhoneNumber|internationalPhoneNumber)"\s*:\s*"[^"]*"/g,
      '"phoneNumber":"[REDACTED]"'
    );

    // Redact websiteUri
    scrubbed = scrubbed.replace(
      /"websiteUri"\s*:\s*"[^"]*"/g,
      '"websiteUri":"[REDACTED]"'
    );

    return scrubbed;
  }

  // Scrub extra context
  if (scrubbed.extra) {
    scrubbed.extra = scrubObject(scrubbed.extra) as Record<string, unknown>;
  }

  // Scrub contexts
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubObject(scrubbed.contexts) as Record<string, unknown>;
  }

  // Scrub breadcrumbs
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubStringValue(crumb.message) : crumb.message,
      data: crumb.data
        ? (scrubObject(crumb.data) as Record<string, unknown>)
        : crumb.data,
    }));
  }

  // Scrub exception values (error messages)
  if (scrubbed.exception?.values) {
    scrubbed.exception.values = scrubbed.exception.values.map((ex) => ({
      ...ex,
      value: ex.value ? scrubStringValue(ex.value) : ex.value,
    }));
  }

  // Scrub top-level message
  if (scrubbed.message) {
    scrubbed.message = scrubStringValue(scrubbed.message);
  }

  return scrubbed;
}

/**
 * Verify that an event has been properly scrubbed
 */
function containsProviderContent(event: MockSentryEvent): boolean {
  const jsonStr = JSON.stringify(event);

  // Check for any provider field names with actual values
  for (const field of SENTRY_SCRUB_FIELDS) {
    // Look for the field with a non-redacted value
    const pattern = new RegExp(
      `"${field}"\\s*:\\s*"(?!\\[REDACTED)[^"]+"`
    );
    if (pattern.test(jsonStr)) {
      return true;
    }
  }

  return false;
}

describe("Sentry Redaction Compliance", () => {
  describe("beforeSend hook scrubbing", () => {
    it("should scrub displayName from extra context", () => {
      const event: MockSentryEvent = {
        extra: {
          placeData: {
            placeKey: "g:ChIJ123abc",
            displayName: "Cafe Clock Marrakech",
          },
        },
      };

      const scrubbed = sentryBeforeSend(event);

      expect(scrubbed?.extra?.placeData).toBeDefined();
      const placeData = scrubbed?.extra?.placeData as Record<string, unknown>;
      expect(placeData.displayName).toBe("[REDACTED_PROVIDER_CONTENT]");
      expect(placeData.placeKey).toBe("g:ChIJ123abc"); // placeKey should be preserved
    });

    it("should scrub formattedAddress from extra context", () => {
      const event: MockSentryEvent = {
        extra: {
          place: {
            formattedAddress: "123 Medina, Marrakech, Morocco",
          },
        },
      };

      const scrubbed = sentryBeforeSend(event);

      const place = scrubbed?.extra?.place as Record<string, unknown>;
      expect(place.formattedAddress).toBe("[REDACTED_PROVIDER_CONTENT]");
    });

    it("should scrub phone numbers from extra context", () => {
      const event: MockSentryEvent = {
        extra: {
          contact: {
            nationalPhoneNumber: "+212 524 123456",
            internationalPhoneNumber: "+212524123456",
          },
        },
      };

      const scrubbed = sentryBeforeSend(event);

      const contact = scrubbed?.extra?.contact as Record<string, unknown>;
      expect(contact.nationalPhoneNumber).toBe("[REDACTED_PROVIDER_CONTENT]");
      expect(contact.internationalPhoneNumber).toBe("[REDACTED_PROVIDER_CONTENT]");
    });

    it("should scrub provider content from exception messages", () => {
      const event: MockSentryEvent = {
        exception: {
          values: [
            {
              type: "Error",
              value:
                'Failed to process place: {"displayName":"Test Cafe","formattedAddress":"123 Test St"}',
            },
          ],
        },
      };

      const scrubbed = sentryBeforeSend(event);

      const exValue = scrubbed?.exception?.values?.[0]?.value;
      expect(exValue).not.toContain("Test Cafe");
      expect(exValue).not.toContain("123 Test St");
      expect(exValue).toContain("[REDACTED]");
    });

    it("should scrub provider content from breadcrumbs", () => {
      const event: MockSentryEvent = {
        breadcrumbs: [
          {
            category: "api",
            message:
              'API call returned: {"displayName":"Restaurant ABC","rating":4.5}',
            data: {
              url: "/api/place/123",
              displayName: "Restaurant ABC",
            },
          },
        ],
      };

      const scrubbed = sentryBeforeSend(event);

      const crumb = scrubbed?.breadcrumbs?.[0];
      expect(crumb?.message).not.toContain("Restaurant ABC");
      expect(crumb?.data?.displayName).toBe("[REDACTED_PROVIDER_CONTENT]");
    });

    it("should scrub rating and reviews from extra context", () => {
      const event: MockSentryEvent = {
        extra: {
          providerResponse: {
            placeKey: "g:123",
            rating: 4.5,
            userRatingCount: 1234,
            reviews: [{ text: "Great food!", rating: 5 }],
          },
        },
      };

      const scrubbed = sentryBeforeSend(event);

      const response = scrubbed?.extra?.providerResponse as Record<
        string,
        unknown
      >;
      expect(response.rating).toBe("[REDACTED_PROVIDER_CONTENT]");
      expect(response.userRatingCount).toBe("[REDACTED_PROVIDER_CONTENT]");
      expect(response.reviews).toBe("[REDACTED_PROVIDER_CONTENT]");
      // placeKey should be preserved
      expect(response.placeKey).toBe("g:123");
    });

    it("should handle deeply nested provider content", () => {
      const event: MockSentryEvent = {
        extra: {
          response: {
            data: {
              place: {
                details: {
                  displayName: "Hidden Cafe",
                  location: {
                    formattedAddress: "Deep nested address",
                  },
                },
              },
            },
          },
        },
      };

      const scrubbed = sentryBeforeSend(event);

      // Navigate the nested structure
      const response = scrubbed?.extra?.response as Record<string, unknown>;
      const data = response?.data as Record<string, unknown>;
      const place = data?.place as Record<string, unknown>;
      const details = place?.details as Record<string, unknown>;
      const location = details?.location as Record<string, unknown>;

      expect(details?.displayName).toBe("[REDACTED_PROVIDER_CONTENT]");
      expect(location?.formattedAddress).toBe("[REDACTED_PROVIDER_CONTENT]");
    });

    it("should preserve safe fields", () => {
      const event: MockSentryEvent = {
        extra: {
          requestId: "req_123_abc",
          endpointClass: "place_details",
          fieldSet: "PLACE_HEADER",
          latencyMs: 150,
          errorCode: "RATE_LIMITED",
          placeKey: "g:ChIJ123abc",
        },
        tags: {
          serviceMode: "0",
        },
      };

      const scrubbed = sentryBeforeSend(event);

      // All safe fields should be preserved
      expect(scrubbed?.extra?.requestId).toBe("req_123_abc");
      expect(scrubbed?.extra?.endpointClass).toBe("place_details");
      expect(scrubbed?.extra?.fieldSet).toBe("PLACE_HEADER");
      expect(scrubbed?.extra?.latencyMs).toBe(150);
      expect(scrubbed?.extra?.errorCode).toBe("RATE_LIMITED");
      expect(scrubbed?.extra?.placeKey).toBe("g:ChIJ123abc");
      expect(scrubbed?.tags?.serviceMode).toBe("0");
    });

    it("should not crash on null/undefined values", () => {
      const event: MockSentryEvent = {
        extra: {
          nullValue: null,
          undefinedValue: undefined,
          emptyObject: {},
          emptyArray: [],
        },
      };

      expect(() => sentryBeforeSend(event)).not.toThrow();

      const scrubbed = sentryBeforeSend(event);
      expect(scrubbed).toBeDefined();
    });
  });

  describe("Provider content detection", () => {
    it("should detect unscrubbed displayName", () => {
      const event: MockSentryEvent = {
        extra: {
          displayName: "Actual Cafe Name",
        },
      };

      // Before scrubbing, should contain provider content
      expect(containsProviderContent(event)).toBe(true);

      // After scrubbing, should not
      const scrubbed = sentryBeforeSend(event);
      expect(containsProviderContent(scrubbed!)).toBe(false);
    });

    it("should pass for properly scrubbed events", () => {
      const event: MockSentryEvent = {
        extra: {
          displayName: "[REDACTED_PROVIDER_CONTENT]",
          placeKey: "g:123",
        },
      };

      expect(containsProviderContent(event)).toBe(false);
    });
  });
});

describe("Sentry Configuration Compliance", () => {
  it("should have a comprehensive scrub fields list", () => {
    // Verify critical provider fields are in the scrub list
    expect(SENTRY_SCRUB_FIELDS).toContain("displayName");
    expect(SENTRY_SCRUB_FIELDS).toContain("formattedAddress");
    expect(SENTRY_SCRUB_FIELDS).toContain("nationalPhoneNumber");
    expect(SENTRY_SCRUB_FIELDS).toContain("websiteUri");
    expect(SENTRY_SCRUB_FIELDS).toContain("reviews");
    expect(SENTRY_SCRUB_FIELDS).toContain("photos");
    expect(SENTRY_SCRUB_FIELDS).toContain("rating");
  });

  it("should preserve debugging fields", () => {
    // Verify we can still debug effectively
    expect(SENTRY_SAFE_FIELDS).toContain("placeKey");
    expect(SENTRY_SAFE_FIELDS).toContain("requestId");
    expect(SENTRY_SAFE_FIELDS).toContain("errorCode");
    expect(SENTRY_SAFE_FIELDS).toContain("endpointClass");
    expect(SENTRY_SAFE_FIELDS).toContain("latencyMs");
  });
});
