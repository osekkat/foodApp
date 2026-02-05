/**
 * Sentry Client Configuration
 *
 * This file configures Sentry for client-side error tracking.
 *
 * CRITICAL: Provider content (place names, addresses, etc.) must NEVER appear in Sentry.
 * The beforeSend and beforeBreadcrumb hooks scrub all provider data.
 */
import * as Sentry from "@sentry/nextjs";

/**
 * Provider content fields that must be scrubbed from Sentry events
 */
const PROVIDER_SCRUB_FIELDS = new Set([
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
  "primaryTypeDisplayName",
  "paymentOptions",
  "parkingOptions",
  "accessibilityOptions",
]);

/**
 * Deep scrub an object, removing provider content fields
 */
function scrubObject(obj: unknown, depth: number = 0): unknown {
  if (depth > 10) return obj; // Prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PROVIDER_SCRUB_FIELDS.has(key)) {
      result[key] = "[REDACTED_PROVIDER_CONTENT]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = scrubObject(value, depth + 1);
    } else if (typeof value === "string") {
      result[key] = scrubStringValue(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Scrub string values that might contain embedded provider content
 */
function scrubStringValue(value: string): string {
  let scrubbed = value;

  // Redact displayName values in JSON
  scrubbed = scrubbed.replace(
    /"displayName"\s*:\s*"[^"]*"/g,
    '"displayName":"[REDACTED]"'
  );

  // Redact formattedAddress values
  scrubbed = scrubbed.replace(
    /"formattedAddress"\s*:\s*"[^"]*"/g,
    '"formattedAddress":"[REDACTED]"'
  );

  // Redact phone numbers (preserve key names)
  scrubbed = scrubbed.replace(
    /"(nationalPhoneNumber|internationalPhoneNumber)"\s*:\s*"[^"]*"/g,
    '"$1":"[REDACTED]"'
  );

  // Redact websiteUri
  scrubbed = scrubbed.replace(
    /"websiteUri"\s*:\s*"[^"]*"/g,
    '"websiteUri":"[REDACTED]"'
  );

  return scrubbed;
}

/**
 * Scrub a Sentry event before sending
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Deep clone to avoid mutating original
  const scrubbed = JSON.parse(JSON.stringify(event)) as Sentry.ErrorEvent;

  // Scrub extra context
  if (scrubbed.extra) {
    scrubbed.extra = scrubObject(scrubbed.extra) as Record<string, unknown>;
  }

  // Scrub contexts
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubObject(scrubbed.contexts) as Sentry.ErrorEvent["contexts"];
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
    scrubbed.message = scrubStringValue(String(scrubbed.message));
  }

  return scrubbed;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment from Next.js
  environment: process.env.NODE_ENV,

  // Adjust sample rate in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Disable debug logging (too verbose)
  debug: false,

  // Replay configuration
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Scrub provider content before sending
  beforeSend(event) {
    return scrubEvent(event);
  },

  // Scrub breadcrumbs as they're created
  beforeBreadcrumb(breadcrumb) {
    // Scrub fetch breadcrumbs that might contain provider data
    if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
      // Redact URLs to Google Places API
      if (breadcrumb.data?.url?.includes("places.googleapis.com")) {
        breadcrumb.data.url = "[REDACTED_PROVIDER_URL]";
        if (breadcrumb.data.body) {
          breadcrumb.data.body = "[REDACTED]";
        }
      }

      // Redact any response data
      if (breadcrumb.data?.response) {
        breadcrumb.data.response = "[REDACTED]";
      }
    }

    // Scrub message content
    if (breadcrumb.message) {
      breadcrumb.message = scrubStringValue(breadcrumb.message);
    }

    return breadcrumb;
  },

  // Filter sensitive data from tags
  beforeSendTransaction(event) {
    if (event.tags) {
      // Remove any tags that might contain provider content
      const safeKeys = [
        "environment",
        "release",
        "serviceMode",
        "endpointClass",
        "cacheHit",
      ];
      const filtered: Record<string, string> = {};
      for (const key of safeKeys) {
        if (event.tags[key] !== undefined) {
          filtered[key] = String(event.tags[key]);
        }
      }
      event.tags = filtered;
    }
    return event;
  },

  integrations: [
    Sentry.replayIntegration({
      // Mask all text in replay for privacy
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
