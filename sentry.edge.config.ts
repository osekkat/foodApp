/**
 * Sentry Edge Runtime Configuration
 *
 * This file configures Sentry for edge runtime (middleware, edge API routes).
 *
 * CRITICAL: Provider content must NEVER appear in Sentry events.
 */
import * as Sentry from "@sentry/nextjs";

/**
 * Provider content fields that must be scrubbed
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

function scrubObject(obj: unknown, depth: number = 0): unknown {
  if (depth > 10) return obj;
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

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const scrubbed = JSON.parse(JSON.stringify(event)) as Sentry.ErrorEvent;

  if (scrubbed.extra) {
    scrubbed.extra = scrubObject(scrubbed.extra) as Record<string, unknown>;
  }

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
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  debug: process.env.NODE_ENV !== "production",

  beforeSend(event) {
    return scrubEvent(event);
  },
});
