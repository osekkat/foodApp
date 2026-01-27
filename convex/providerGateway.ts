/**
 * Provider Gateway - Central enforcement point for all provider API access
 *
 * All provider API calls MUST go through this gateway to ensure:
 * 1. Only pre-approved field masks are used
 * 2. Budget limits are enforced
 * 3. Circuit breaker state is respected
 * 4. Metrics are emitted for every call
 * 5. Response bodies are NEVER logged (policy compliance)
 * 6. Localization defaults are applied
 *
 * This file will have import errors until Convex is initialized with `bunx convex dev`
 */

import {
  FIELD_SETS,
  type FieldSetKey,
  type EndpointClass,
  DAILY_BUDGET_LIMITS,
  getFieldMask,
  getCostTier,
  getMaxCost,
} from "./fieldSets";

// These imports require Convex to be initialized
// Uncomment after running `bunx convex dev`:
// import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
// import { internal } from "./_generated/api";
// import { v } from "convex/values";

/**
 * Supported languages for localization
 */
export type SupportedLanguage = "ar" | "fr" | "en";

/**
 * Provider request parameters
 */
export interface ProviderRequestParams {
  /** The field set to use (must be from registry) */
  fieldSet: FieldSetKey;
  /** Endpoint class for budget tracking */
  endpointClass: EndpointClass;
  /** User's preferred language */
  language?: SupportedLanguage;
  /** Override region code (default: MA) */
  regionCode?: string;
  /** Session token for autocomplete flows */
  sessionToken?: string;
  /** Place ID for detail requests */
  placeId?: string;
  /** Query for search requests */
  query?: string;
  /** Location bias for searches */
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
  /** Bounding box for viewport searches */
  locationRestriction?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

/**
 * Gateway options
 */
export interface GatewayOptions {
  /** Skip budget check (for health checks only) */
  skipBudgetCheck?: boolean;
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Priority level for load shedding */
  priority?: "high" | "normal" | "low";
}

/**
 * Provider result wrapper
 */
export interface ProviderResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: {
    requestId: string;
    latencyMs: number;
    costClass: string;
    fieldSet: FieldSetKey;
    endpointClass: EndpointClass;
    cacheHit: boolean;
  };
}

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * Build the Google Places API (New) URL for a request
 */
export function buildPlacesApiUrl(
  endpoint: "places" | "places:searchText" | "places:searchNearby",
  placeId?: string
): string {
  const baseUrl = "https://places.googleapis.com/v1";

  switch (endpoint) {
    case "places":
      if (!placeId) throw new Error("placeId required for place details");
      return `${baseUrl}/places/${placeId}`;
    case "places:searchText":
      return `${baseUrl}/places:searchText`;
    case "places:searchNearby":
      return `${baseUrl}/places:searchNearby`;
    default:
      throw new Error(`Unknown endpoint: ${endpoint}`);
  }
}

/**
 * Build request headers for Google Places API (New)
 */
export function buildHeaders(
  apiKey: string,
  fieldMask: string,
  sessionToken?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
  };

  if (sessionToken) {
    headers["X-Goog-Session-Token"] = sessionToken;
  }

  return headers;
}

/**
 * Generate a unique request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Redact provider content from error messages
 * NEVER include place names, addresses, etc. in logs
 */
export function redactProviderContent(message: string): string {
  // Remove any JSON-like content that might contain provider data
  // This is a conservative approach - better to over-redact than leak
  return message
    .replace(/"displayName":\s*"[^"]*"/g, '"displayName":"[REDACTED]"')
    .replace(/"formattedAddress":\s*"[^"]*"/g, '"formattedAddress":"[REDACTED]"')
    .replace(/"nationalPhoneNumber":\s*"[^"]*"/g, '"nationalPhoneNumber":"[REDACTED]"')
    .replace(/"websiteUri":\s*"[^"]*"/g, '"websiteUri":"[REDACTED]"');
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(status: number): boolean {
  // 429 (rate limit), 500, 502, 503, 504 are retryable
  return status === 429 || (status >= 500 && status <= 504);
}

/**
 * Map HTTP status to error code
 */
export function statusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "INVALID_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL_ERROR";
    case 502:
      return "BAD_GATEWAY";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 504:
      return "GATEWAY_TIMEOUT";
    default:
      return `HTTP_${status}`;
  }
}

// ============================================================================
// The following functions require Convex to be initialized
// They are commented out until `bunx convex dev` creates the _generated files
// ============================================================================

/*
// Internal query to check circuit breaker state
export const getCircuitState = internalQuery({
  args: { service: v.string() },
  handler: async (ctx, args): Promise<CircuitState> => {
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (!health) return "closed"; // Default to closed (allow requests)
    if (!health.healthy) return "open";
    return "closed";
  },
});

// Internal mutation to update circuit breaker state
export const updateCircuitState = internalMutation({
  args: {
    service: v.string(),
    healthy: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        healthy: args.healthy,
        lastCheckedAt: now,
        ...(args.healthy ? { lastHealthyAt: now } : {}),
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: args.healthy,
        lastCheckedAt: now,
        ...(args.healthy ? { lastHealthyAt: now } : {}),
      });
    }
  },
});

// Internal query to check daily budget usage
export const checkBudget = internalQuery({
  args: { endpointClass: v.string() },
  handler: async (ctx, args): Promise<{ allowed: boolean; used: number; limit: number }> => {
    const limit = DAILY_BUDGET_LIMITS[args.endpointClass as EndpointClass] ?? 1000;

    // Get today's usage from rate limits table
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;
    const usage = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    const used = usage?.count ?? 0;
    return {
      allowed: used < limit,
      used,
      limit,
    };
  },
});

// Internal mutation to record budget usage
export const recordBudgetUsage = internalMutation({
  args: {
    endpointClass: v.string(),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + args.cost,
      });
    } else {
      await ctx.db.insert("rateLimits", {
        key: todayKey,
        windowStart: Date.now(),
        count: args.cost,
      });
    }
  },
});

// Main provider request action
// This is the ONLY way to make provider API calls
export const providerRequest = internalAction({
  args: {
    fieldSet: v.string(),
    endpointClass: v.string(),
    language: v.optional(v.string()),
    regionCode: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    placeId: v.optional(v.string()),
    query: v.optional(v.string()),
    locationBias: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
      radiusMeters: v.optional(v.number()),
    })),
    locationRestriction: v.optional(v.object({
      north: v.number(),
      south: v.number(),
      east: v.number(),
      west: v.number(),
    })),
    skipBudgetCheck: v.optional(v.boolean()),
    timeoutMs: v.optional(v.number()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProviderResult<unknown>> => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Validate field set is in registry
    if (!(args.fieldSet in FIELD_SETS)) {
      return {
        success: false,
        error: {
          code: "INVALID_FIELD_SET",
          message: `Field set '${args.fieldSet}' not in registry`,
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: args.fieldSet as FieldSetKey,
          endpointClass: args.endpointClass as EndpointClass,
          cacheHit: false,
        },
      };
    }

    const fieldSetKey = args.fieldSet as FieldSetKey;
    const endpointClass = args.endpointClass as EndpointClass;

    // Check circuit breaker
    const circuitState = await ctx.runQuery(internal.providerGateway.getCircuitState, {
      service: "google_places",
    });

    if (circuitState === "open") {
      return {
        success: false,
        error: {
          code: "CIRCUIT_OPEN",
          message: "Provider service unavailable - circuit breaker open",
          retryable: true,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: getCostTier(fieldSetKey),
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      };
    }

    // Check budget
    if (!args.skipBudgetCheck) {
      const budget = await ctx.runQuery(internal.providerGateway.checkBudget, {
        endpointClass,
      });

      if (!budget.allowed) {
        return {
          success: false,
          error: {
            code: "BUDGET_EXCEEDED",
            message: `Daily budget exceeded for ${endpointClass}`,
            retryable: false,
          },
          metadata: {
            requestId,
            latencyMs: Date.now() - startTime,
            costClass: getCostTier(fieldSetKey),
            fieldSet: fieldSetKey,
            endpointClass,
            cacheHit: false,
          },
        };
      }
    }

    // Get API key from environment
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: {
          code: "CONFIG_ERROR",
          message: "Google Places API key not configured",
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: getCostTier(fieldSetKey),
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      };
    }

    // Build request
    const fieldMask = getFieldMask(fieldSetKey);
    const headers = buildHeaders(apiKey, fieldMask, args.sessionToken);
    const language = args.language ?? "en";
    const regionCode = args.regionCode ?? "MA";

    // Execute request with timeout
    const timeout = args.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Determine endpoint and build URL
      let url: string;
      let method: "GET" | "POST" = "GET";
      let body: string | undefined;

      if (args.placeId && endpointClass === "place_details") {
        url = buildPlacesApiUrl("places", args.placeId);
        url += `?languageCode=${language}&regionCode=${regionCode}`;
      } else if (args.query && endpointClass === "text_search") {
        url = buildPlacesApiUrl("places:searchText");
        method = "POST";
        body = JSON.stringify({
          textQuery: args.query,
          languageCode: language,
          regionCode: regionCode,
          ...(args.locationBias && {
            locationBias: {
              circle: {
                center: {
                  latitude: args.locationBias.lat,
                  longitude: args.locationBias.lng,
                },
                radius: args.locationBias.radiusMeters ?? 5000,
              },
            },
          }),
          ...(args.locationRestriction && {
            locationRestriction: {
              rectangle: {
                low: {
                  latitude: args.locationRestriction.south,
                  longitude: args.locationRestriction.west,
                },
                high: {
                  latitude: args.locationRestriction.north,
                  longitude: args.locationRestriction.east,
                },
              },
            },
          }),
        });
      } else {
        throw new Error("Invalid request parameters");
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      // Record budget usage (don't await, fire and forget)
      ctx.runMutation(internal.providerGateway.recordBudgetUsage, {
        endpointClass,
        cost: getMaxCost(fieldSetKey),
      });

      if (!response.ok) {
        // Update circuit breaker on failure
        if (response.status >= 500) {
          await ctx.runMutation(internal.providerGateway.updateCircuitState, {
            service: "google_places",
            healthy: false,
          });
        }

        return {
          success: false,
          error: {
            code: statusToErrorCode(response.status),
            message: redactProviderContent(`Provider request failed with status ${response.status}`),
            retryable: isRetryableError(response.status),
          },
          metadata: {
            requestId,
            latencyMs,
            costClass: getCostTier(fieldSetKey),
            fieldSet: fieldSetKey,
            endpointClass,
            cacheHit: false,
          },
        };
      }

      // Update circuit breaker on success
      await ctx.runMutation(internal.providerGateway.updateCircuitState, {
        service: "google_places",
        healthy: true,
      });

      const data = await response.json();

      // IMPORTANT: Never log the response data!
      // Only return it to the caller

      return {
        success: true,
        data,
        metadata: {
          requestId,
          latencyMs,
          costClass: getCostTier(fieldSetKey),
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      const isAbort = error instanceof Error && error.name === "AbortError";

      return {
        success: false,
        error: {
          code: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
          message: redactProviderContent(isAbort ? "Request timed out" : "Network error occurred"),
          retryable: true,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: getCostTier(fieldSetKey),
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      };
    }
  },
});
*/

/**
 * USAGE NOTE:
 *
 * After running `bunx convex dev` to initialize Convex:
 * 1. Uncomment the Convex imports at the top
 * 2. Uncomment the internal queries/mutations/actions above
 * 3. Add GOOGLE_PLACES_API_KEY to Convex environment variables
 *
 * All provider API calls should then use:
 *   await ctx.runAction(internal.providerGateway.providerRequest, { ... })
 *
 * Never call the Google Places API directly!
 */
