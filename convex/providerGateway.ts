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
 * Currently supported endpoint classes: place_details, text_search, autocomplete, photos
 * TODO: Implement nearby_search, health
 */

import {
  FIELD_SETS,
  type FieldSetKey,
  type EndpointClass,
  ENDPOINT_CLASSES,
  DAILY_BUDGET_LIMITS,
  getFieldMask,
  getCostTier,
  getMaxCost,
} from "./fieldSets";
import {
  generateSearchCacheKey,
  extractPlaceKeysFromSearchResponse,
} from "./searchCache";
import { singleflight, detailsKey, autocompleteKey } from "../lib/singleflight";

// Convex imports (now that Convex is initialized)
import { query, mutation, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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
  /**
   * Whether text_search cache hits may return ID-only results ({ placeKey }).
   * Keep false for UI flows that require full place display data.
   */
  allowIdOnlySearchCacheResponse?: boolean;
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
 * Emit safe, redacted metrics for every provider call.
 * NOTE: Never log provider response bodies or provider content fields.
 */
function emitProviderMetric(result: ProviderResult<unknown>) {
  const { metadata, success, error } = result;
  const payload = {
    requestId: metadata.requestId,
    success,
    errorCode: error?.code,
    endpointClass: metadata.endpointClass,
    fieldSet: metadata.fieldSet,
    costClass: metadata.costClass,
    latencyMs: metadata.latencyMs,
    cacheHit: metadata.cacheHit,
  };

  // Structured log for metrics collection (safe metadata only).
  console.info("provider_gateway_metric", JSON.stringify(payload));
}

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * Build the Google Places API (New) URL for a request
 */
export function buildPlacesApiUrl(
  endpoint: "places" | "places:searchText" | "places:searchNearby" | "places:autocomplete",
  placeId?: string
): string {
  const baseUrl = "https://places.googleapis.com/v1";

  switch (endpoint) {
    case "places":
      if (!placeId) throw new Error("placeId required for place details");
      return `${baseUrl}/places/${placeId}`;
    case "places:searchText":
      return `${baseUrl}/places:searchText`;
    case "places:autocomplete":
      return `${baseUrl}/places:autocomplete`;
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
// Priority Classes for Load Shedding
// ============================================================================

/**
 * Priority classes (1 = highest, 4 = lowest)
 *
 * P1: Place details - Explicit user click, highest intent
 * P2: Search results - Explicit search submit
 * P3: Autocomplete - Typing, can degrade gracefully
 * P4: Photos + 'more results' - Nice to have, shed first
 */
export type PriorityClass = 1 | 2 | 3 | 4;

/**
 * Map endpoint classes to priority classes
 */
export const ENDPOINT_TO_PRIORITY: Record<EndpointClass, PriorityClass> = {
  place_details: 1,   // P1: Highest priority - explicit user intent
  text_search: 2,     // P2: Search results
  nearby_search: 2,   // P2: Map search (same as text search)
  autocomplete: 3,    // P3: Can degrade gracefully
  photos: 4,          // P4: Shed first
  health: 1,          // P1: Health checks are critical
};

/**
 * Load shedding configuration
 */
export const LOAD_SHEDDING_CONFIG = {
  /** Max concurrent provider calls per region (bulkhead) */
  maxConcurrentCalls: 25,

  /** Queue depths by priority class (P4 has limited queue) */
  queueDepths: {
    1: Infinity,  // P1: Never queue-limited
    2: 50,        // P2: Generous queue
    3: 20,        // P3: Moderate queue
    4: 5,         // P4: Small queue - shed when full
  } as Record<PriorityClass, number>,

  /** Load levels and their thresholds (percentage of maxConcurrentCalls) */
  loadLevels: {
    normal: 0.5,    // < 50% = normal
    elevated: 0.75, // 50-75% = elevated
    high: 0.9,      // 75-90% = high
    critical: 1.0,  // >= 90% = critical
  },

  /** Which priorities to shed at each load level */
  sheddingPolicy: {
    normal: [],           // Shed nothing
    elevated: [4],        // Shed P4 only
    high: [4, 3],         // Shed P4 and P3
    critical: [4, 3],     // Shed P4 and P3 (keep P1 and P2)
  } as Record<string, PriorityClass[]>,
};

/**
 * Load level type
 */
export type LoadLevel = "normal" | "elevated" | "high" | "critical";

/**
 * Load shedding decision result
 */
export interface SheddingDecision {
  proceed: boolean;
  reason: "allowed" | "queue_full" | "load_shed" | "budget_shed";
  loadLevel: LoadLevel;
  currentLoad: number;
  queueDepth: number;
}

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

/**
 * Circuit breaker thresholds
 */
const CIRCUIT_BREAKER_CONFIG = {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: 5,
  /** Time window for error rate calculation (ms) */
  errorRateWindow: 60000, // 1 minute
  /** Error rate threshold (0-1) before opening circuit */
  errorRateThreshold: 0.5,
  /** Time to wait in open state before trying half-open (ms) */
  halfOpenDelay: 30000, // 30 seconds
  /** Number of successful requests needed in half-open to close */
  halfOpenSuccessThreshold: 1,
};

/**
 * Circuit breaker state with detailed tracking
 */
export interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  halfOpenAttempts: number;
}

// ============================================================================
// Convex Functions (now active)
// ============================================================================

// Internal query to get circuit breaker detailed state
export const getCircuitBreakerState = internalQuery({
  args: { service: v.string() },
  handler: async (ctx, args): Promise<CircuitBreakerState> => {
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    // Get failure count from rateLimits
    const failureKey = `circuit:failures:${args.service}`;
    const failureRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", failureKey))
      .first();

    // Get half-open attempt count
    const halfOpenKey = `circuit:halfopen:${args.service}`;
    const halfOpenRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", halfOpenKey))
      .first();

    if (!health) {
      return {
        state: "closed",
        consecutiveFailures: 0,
        halfOpenAttempts: 0,
      };
    }

    const now = Date.now();
    const consecutiveFailures = failureRecord?.count ?? 0;
    const halfOpenAttempts = halfOpenRecord?.count ?? 0;

    // Determine state
    if (health.healthy) {
      return {
        state: "closed",
        consecutiveFailures: 0,
        lastSuccessAt: health.lastHealthyAt,
        halfOpenAttempts: 0,
      };
    }

    // Circuit is unhealthy - check if we should try half-open
    const timeSinceUnhealthy = now - health.lastCheckedAt;

    if (timeSinceUnhealthy >= CIRCUIT_BREAKER_CONFIG.halfOpenDelay) {
      return {
        state: "half_open",
        consecutiveFailures,
        lastFailureAt: health.lastCheckedAt,
        lastSuccessAt: health.lastHealthyAt,
        openedAt: health.lastCheckedAt,
        halfOpenAttempts,
      };
    }

    return {
      state: "open",
      consecutiveFailures,
      lastFailureAt: health.lastCheckedAt,
      lastSuccessAt: health.lastHealthyAt,
      openedAt: health.lastCheckedAt,
      halfOpenAttempts,
    };
  },
});

// Simplified query for just the state (backward compatible)
export const getCircuitState = internalQuery({
  args: { service: v.string() },
  handler: async (ctx, args): Promise<CircuitState> => {
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (!health) return "closed";
    if (health.healthy) return "closed";

    // Check if we should try half-open
    const now = Date.now();
    const timeSinceUnhealthy = now - health.lastCheckedAt;

    if (timeSinceUnhealthy >= CIRCUIT_BREAKER_CONFIG.halfOpenDelay) {
      return "half_open";
    }

    return "open";
  },
});

// Internal mutation to record circuit breaker failure
export const recordCircuitFailure = internalMutation({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const failureKey = `circuit:failures:${args.service}`;

    // Increment failure count
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", failureKey))
      .first();

    let consecutiveFailures = 1;
    if (existing) {
      consecutiveFailures = existing.count + 1;
      await ctx.db.patch(existing._id, { count: consecutiveFailures });
    } else {
      await ctx.db.insert("rateLimits", {
        key: failureKey,
        windowStart: now,
        count: 1,
      });
    }

    // Check if we should open the circuit
    const shouldOpen = consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold;

    // Update health record
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (health) {
      await ctx.db.patch(health._id, {
        healthy: !shouldOpen,
        lastCheckedAt: now,
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: !shouldOpen,
        lastCheckedAt: now,
      });
    }

    return { shouldOpen, consecutiveFailures };
  },
});

// Internal mutation to record circuit breaker success
export const recordCircuitSuccess = internalMutation({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const failureKey = `circuit:failures:${args.service}`;
    const halfOpenKey = `circuit:halfopen:${args.service}`;

    // Reset failure count
    const failureRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", failureKey))
      .first();

    if (failureRecord) {
      await ctx.db.patch(failureRecord._id, { count: 0, windowStart: now });
    }

    // Reset half-open attempts
    const halfOpenRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", halfOpenKey))
      .first();

    if (halfOpenRecord) {
      await ctx.db.patch(halfOpenRecord._id, { count: 0, windowStart: now });
    }

    // Update health record to healthy
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (health) {
      await ctx.db.patch(health._id, {
        healthy: true,
        lastCheckedAt: now,
        lastHealthyAt: now,
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: true,
        lastCheckedAt: now,
        lastHealthyAt: now,
      });
    }
  },
});

// Internal mutation to record half-open test attempt
export const recordHalfOpenAttempt = internalMutation({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const halfOpenKey = `circuit:halfopen:${args.service}`;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", halfOpenKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        key: halfOpenKey,
        windowStart: now,
        count: 1,
      });
    }
  },
});

// Legacy mutation for backward compatibility
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

/**
 * Budget check result with warning thresholds
 */
export interface BudgetCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  usagePercent: number;
  warning: boolean;
  warningLevel?: "approaching" | "critical";
}

// Internal query to check daily budget usage with warning thresholds
export const checkBudget = internalQuery({
  args: { endpointClass: v.string() },
  handler: async (ctx, args): Promise<BudgetCheckResult> => {
    const limit = DAILY_BUDGET_LIMITS[args.endpointClass as EndpointClass] ?? 1000;

    // Get today's usage from rate limits table
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;
    const usage = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    const used = usage?.count ?? 0;
    const usagePercent = (used / limit) * 100;

    // Determine warning level
    let warning = false;
    let warningLevel: "approaching" | "critical" | undefined;

    if (usagePercent >= 95) {
      warning = true;
      warningLevel = "critical";
    } else if (usagePercent >= 80) {
      warning = true;
      warningLevel = "approaching";
    }

    return {
      allowed: used < limit,
      used,
      limit,
      usagePercent,
      warning,
      warningLevel,
    };
  },
});

/**
 * Auto-mitigation: Map endpoint classes to features that can be disabled
 * When budget is exceeded, these features are disabled in priority order
 */
const AUTO_MITIGATION_MAP: Record<EndpointClass, string[]> = {
  photos: ["photos_enabled"], // Disable photos first (expensive, least critical)
  nearby_search: ["nearby_search_enabled"],
  text_search: ["text_search_enabled"],
  place_details: ["place_details_enhanced"], // Reduce to basic details only
  autocomplete: [], // Autocomplete is cheap, don't disable
  health: [], // Never disable health checks
};

// ============================================================================
// Load Tracking & Shedding Decision Functions
// ============================================================================

/**
 * Get current load level based on active concurrent requests
 */
export const getCurrentLoad = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    activeRequests: number;
    loadLevel: LoadLevel;
    loadPercent: number;
    queueDepths: Record<string, number>;
  }> => {
    // Get active request count from rateLimits table
    // Key format: "load:active_requests"
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    const activeRequests = activeRecord?.count ?? 0;
    const maxConcurrent = LOAD_SHEDDING_CONFIG.maxConcurrentCalls;
    const loadPercent = activeRequests / maxConcurrent;

    // Determine load level
    let loadLevel: LoadLevel;
    if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.critical) {
      loadLevel = "critical";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.high) {
      loadLevel = "high";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.elevated) {
      loadLevel = "elevated";
    } else {
      loadLevel = "normal";
    }

    // Get queue depths by priority
    const queueDepths: Record<string, number> = {};
    for (const priority of [1, 2, 3, 4] as PriorityClass[]) {
      const queueRecord = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
        .first();
      queueDepths[`P${priority}`] = queueRecord?.count ?? 0;
    }

    return {
      activeRequests,
      loadLevel,
      loadPercent,
      queueDepths,
    };
  },
});

/**
 * Check if a request should be shed based on priority and current load
 */
export const checkShouldShed = internalQuery({
  args: {
    priority: v.number(),
    endpointClass: v.string(),
  },
  handler: async (ctx, args): Promise<SheddingDecision> => {
    const priority = args.priority as PriorityClass;

    // Get current load state
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    const activeRequests = activeRecord?.count ?? 0;
    const maxConcurrent = LOAD_SHEDDING_CONFIG.maxConcurrentCalls;
    const loadPercent = activeRequests / maxConcurrent;

    // Determine load level
    let loadLevel: LoadLevel;
    if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.critical) {
      loadLevel = "critical";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.high) {
      loadLevel = "high";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.elevated) {
      loadLevel = "elevated";
    } else {
      loadLevel = "normal";
    }

    // Get queue depth for this priority
    const queueRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
      .first();
    const queueDepth = queueRecord?.count ?? 0;

    // Check if queue is full for this priority
    const maxQueueDepth = LOAD_SHEDDING_CONFIG.queueDepths[priority];
    if (queueDepth >= maxQueueDepth) {
      return {
        proceed: false,
        reason: "queue_full",
        loadLevel,
        currentLoad: activeRequests,
        queueDepth,
      };
    }

    // Check if this priority should be shed at current load level
    const prioritiesToShed = LOAD_SHEDDING_CONFIG.sheddingPolicy[loadLevel];
    if (prioritiesToShed.includes(priority)) {
      return {
        proceed: false,
        reason: "load_shed",
        loadLevel,
        currentLoad: activeRequests,
        queueDepth,
      };
    }

    // Request can proceed
    return {
      proceed: true,
      reason: "allowed",
      loadLevel,
      currentLoad: activeRequests,
      queueDepth,
    };
  },
});

/**
 * Increment active request count when starting a request
 */
export const incrementActiveRequests = internalMutation({
  args: { priority: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const priority = args.priority as PriorityClass;

    // Increment global active requests
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    if (activeRecord) {
      await ctx.db.patch(activeRecord._id, { count: activeRecord.count + 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        key: "load:active_requests",
        windowStart: now,
        count: 1,
      });
    }

    // Increment queue depth for this priority
    const queueRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
      .first();

    if (queueRecord) {
      await ctx.db.patch(queueRecord._id, { count: queueRecord.count + 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        key: `load:queue:${priority}`,
        windowStart: now,
        count: 1,
      });
    }
  },
});

/**
 * Decrement active request count when a request completes
 */
export const decrementActiveRequests = internalMutation({
  args: { priority: v.number() },
  handler: async (ctx, args) => {
    const priority = args.priority as PriorityClass;

    // Decrement global active requests (min 0)
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    if (activeRecord && activeRecord.count > 0) {
      await ctx.db.patch(activeRecord._id, { count: activeRecord.count - 1 });
    }

    // Decrement queue depth for this priority (min 0)
    const queueRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
      .first();

    if (queueRecord && queueRecord.count > 0) {
      await ctx.db.patch(queueRecord._id, { count: queueRecord.count - 1 });
    }
  },
});

/**
 * Record a shed event for metrics
 */
export const recordShedEvent = internalMutation({
  args: {
    priority: v.number(),
    endpointClass: v.string(),
    reason: v.string(),
    loadLevel: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Increment shed counter for this priority
    const shedKey = `shed:${args.priority}:${new Date().toISOString().split('T')[0]}`;
    const shedRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", shedKey))
      .first();

    if (shedRecord) {
      await ctx.db.patch(shedRecord._id, { count: shedRecord.count + 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        key: shedKey,
        windowStart: now,
        count: 1,
      });
    }

    // Also record in metrics table for detailed tracking
    await ctx.db.insert("metrics", {
      name: "request_shed",
      value: 1,
      tags: {
        endpoint: args.endpointClass,
        // Store priority in costTier field (reusing existing field)
        costTier: `P${args.priority}`,
      },
      timestamp: now,
    });
  },
});

/**
 * Get shed statistics for monitoring
 */
export const getShedStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    today: Record<string, number>;
    loadState: {
      activeRequests: number;
      loadLevel: LoadLevel;
      queueDepths: Record<string, number>;
    };
  }> => {
    const todayPrefix = `shed:`;
    const todayDate = new Date().toISOString().split('T')[0];

    // Get today's shed counts by priority
    const shedCounts: Record<string, number> = {};
    for (const priority of [1, 2, 3, 4] as PriorityClass[]) {
      const shedRecord = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `${todayPrefix}${priority}:${todayDate}`))
        .first();
      shedCounts[`P${priority}`] = shedRecord?.count ?? 0;
    }

    // Get current load state
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    const activeRequests = activeRecord?.count ?? 0;
    const maxConcurrent = LOAD_SHEDDING_CONFIG.maxConcurrentCalls;
    const loadPercent = activeRequests / maxConcurrent;

    let loadLevel: LoadLevel;
    if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.critical) {
      loadLevel = "critical";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.high) {
      loadLevel = "high";
    } else if (loadPercent >= LOAD_SHEDDING_CONFIG.loadLevels.elevated) {
      loadLevel = "elevated";
    } else {
      loadLevel = "normal";
    }

    // Get queue depths
    const queueDepths: Record<string, number> = {};
    for (const priority of [1, 2, 3, 4] as PriorityClass[]) {
      const queueRecord = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
        .first();
      queueDepths[`P${priority}`] = queueRecord?.count ?? 0;
    }

    return {
      today: shedCounts,
      loadState: {
        activeRequests,
        loadLevel,
        queueDepths,
      },
    };
  },
});

// Internal mutation to update feature flag
export const updateFeatureFlag = internalMutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        reason: args.reason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("featureFlags", {
        key: args.key,
        enabled: args.enabled,
        reason: args.reason,
        updatedAt: now,
      });
    }
  },
});

// Internal query to get feature flag status
export const getFeatureFlag = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<{ enabled: boolean; reason?: string }> => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    return {
      enabled: flag?.enabled ?? true, // Default to enabled
      reason: flag?.reason,
    };
  },
});

// Public query to check feature flag status (for API routes)
export const checkFeatureFlag = query({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<{ enabled: boolean; reason?: string }> => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    return {
      enabled: flag?.enabled ?? true, // Default to enabled
      reason: flag?.reason,
    };
  },
});

// ============================================================================
// Public API for Photo Proxy Route Handler
// These wrappers expose internal functions for use from Next.js API routes
// ============================================================================

// Public query to check circuit breaker state (for API routes)
export const getCircuitStatePublic = query({
  args: { service: v.string() },
  handler: async (ctx, args): Promise<CircuitState> => {
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (!health) return "closed";
    if (health.healthy) return "closed";

    // Check if we should try half-open
    const now = Date.now();
    const timeSinceUnhealthy = now - health.lastCheckedAt;

    if (timeSinceUnhealthy >= CIRCUIT_BREAKER_CONFIG.halfOpenDelay) {
      return "half_open";
    }

    return "open";
  },
});

// Public query to check budget (for API routes)
export const checkBudgetPublic = query({
  args: { endpointClass: v.string() },
  handler: async (ctx, args): Promise<BudgetCheckResult> => {
    const limit = DAILY_BUDGET_LIMITS[args.endpointClass as EndpointClass] ?? 1000;

    // Get today's usage from rate limits table
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;
    const usage = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    const used = usage?.count ?? 0;
    const usagePercent = (used / limit) * 100;

    // Determine warning level
    let warning = false;
    let warningLevel: "approaching" | "critical" | undefined;

    if (usagePercent >= 95) {
      warning = true;
      warningLevel = "critical";
    } else if (usagePercent >= 80) {
      warning = true;
      warningLevel = "approaching";
    }

    return {
      allowed: used < limit,
      used,
      limit,
      usagePercent,
      warning,
      warningLevel,
    };
  },
});

// Public mutation to record circuit failure (for API routes)
export const recordCircuitFailurePublic = mutation({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const failureKey = `circuit:failures:${args.service}`;

    // Increment failure count
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", failureKey))
      .first();

    let consecutiveFailures = 1;
    if (existing) {
      consecutiveFailures = existing.count + 1;
      await ctx.db.patch(existing._id, { count: consecutiveFailures });
    } else {
      await ctx.db.insert("rateLimits", {
        key: failureKey,
        windowStart: now,
        count: 1,
      });
    }

    // Check if we should open the circuit
    const shouldOpen = consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold;

    // Update health record
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (health) {
      await ctx.db.patch(health._id, {
        healthy: !shouldOpen,
        lastCheckedAt: now,
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: !shouldOpen,
        lastCheckedAt: now,
      });
    }

    return { shouldOpen, consecutiveFailures };
  },
});

// Public mutation to record circuit success (for API routes)
export const recordCircuitSuccessPublic = mutation({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const failureKey = `circuit:failures:${args.service}`;
    const halfOpenKey = `circuit:halfopen:${args.service}`;

    // Reset failure count
    const failureRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", failureKey))
      .first();

    if (failureRecord) {
      await ctx.db.patch(failureRecord._id, { count: 0, windowStart: now });
    }

    // Reset half-open attempts
    const halfOpenRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", halfOpenKey))
      .first();

    if (halfOpenRecord) {
      await ctx.db.patch(halfOpenRecord._id, { count: 0, windowStart: now });
    }

    // Update health record to healthy
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (health) {
      await ctx.db.patch(health._id, {
        healthy: true,
        lastCheckedAt: now,
        lastHealthyAt: now,
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: true,
        lastCheckedAt: now,
        lastHealthyAt: now,
      });
    }
  },
});

// Public mutation to record budget usage (for API routes)
export const recordBudgetUsagePublic = mutation({
  args: {
    endpointClass: v.string(),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const endpointClass = args.endpointClass as EndpointClass;
    const limit = DAILY_BUDGET_LIMITS[endpointClass] ?? 1000;
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    const previousCount = existing?.count ?? 0;
    const newCount = previousCount + args.cost;

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: newCount,
      });
    } else {
      await ctx.db.insert("rateLimits", {
        key: todayKey,
        windowStart: Date.now(),
        count: args.cost,
      });
    }

    // Check for auto-mitigation triggers (same logic as internal version)
    const usagePercent = (newCount / limit) * 100;
    const previousUsagePercent = (previousCount / limit) * 100;

    // Trigger auto-mitigation when crossing 95% threshold
    if (previousUsagePercent < 95 && usagePercent >= 95) {
      const featuresToDisable = AUTO_MITIGATION_MAP[endpointClass] ?? [];
      for (const featureKey of featuresToDisable) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", featureKey))
          .first();

        const now = Date.now();
        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled: false,
            reason: `budget_critical_${endpointClass}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key: featureKey,
            enabled: false,
            reason: `budget_critical_${endpointClass}`,
            updatedAt: now,
          });
        }
      }
    }

    // When budget is exceeded (100%), disable features
    if (previousCount < limit && newCount >= limit) {
      const featuresToDisable = AUTO_MITIGATION_MAP[endpointClass] ?? [];
      for (const featureKey of featuresToDisable) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", featureKey))
          .first();

        const now = Date.now();
        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled: false,
            reason: `budget_exceeded_${endpointClass}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key: featureKey,
            enabled: false,
            reason: `budget_exceeded_${endpointClass}`,
            updatedAt: now,
          });
        }
      }
    }
  },
});

// Internal mutation to record budget usage and trigger auto-mitigation if needed
export const recordBudgetUsage = internalMutation({
  args: {
    endpointClass: v.string(),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const endpointClass = args.endpointClass as EndpointClass;
    const limit = DAILY_BUDGET_LIMITS[endpointClass] ?? 1000;
    const todayKey = `budget:${args.endpointClass}:${new Date().toISOString().split('T')[0]}`;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", todayKey))
      .first();

    const previousCount = existing?.count ?? 0;
    const newCount = previousCount + args.cost;

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: newCount,
      });
    } else {
      await ctx.db.insert("rateLimits", {
        key: todayKey,
        windowStart: Date.now(),
        count: args.cost,
      });
    }

    // Check for auto-mitigation triggers
    const usagePercent = (newCount / limit) * 100;
    const previousUsagePercent = (previousCount / limit) * 100;

    // Trigger auto-mitigation when crossing 95% threshold
    if (previousUsagePercent < 95 && usagePercent >= 95) {
      const featuresToDisable = AUTO_MITIGATION_MAP[endpointClass] ?? [];
      for (const featureKey of featuresToDisable) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", featureKey))
          .first();

        const now = Date.now();
        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled: false,
            reason: `budget_critical_${endpointClass}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key: featureKey,
            enabled: false,
            reason: `budget_critical_${endpointClass}`,
            updatedAt: now,
          });
        }
      }
    }

    // When budget is exceeded (100%), disable features
    if (previousCount < limit && newCount >= limit) {
      const featuresToDisable = AUTO_MITIGATION_MAP[endpointClass] ?? [];
      for (const featureKey of featuresToDisable) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", featureKey))
          .first();

        const now = Date.now();
        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled: false,
            reason: `budget_exceeded_${endpointClass}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key: featureKey,
            enabled: false,
            reason: `budget_exceeded_${endpointClass}`,
            updatedAt: now,
          });
        }
      }
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
    /** Allow text_search cache hits to return ID-only rows */
    allowIdOnlySearchCacheResponse: v.optional(v.boolean()),
    /** Autocomplete input text */
    input: v.optional(v.string()),
    /** Types to include in autocomplete (e.g., restaurant, cafe) */
    includedPrimaryTypes: v.optional(v.array(v.string())),
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
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internal: any = require("./_generated/api").internal;

    const requestId = generateRequestId();
    const startTime = Date.now();
    const finalize = (
      result: ProviderResult<unknown>,
      options?: { emitMetrics?: boolean }
    ) => {
      if (options?.emitMetrics !== false) {
        emitProviderMetric(result);
      }
      return result;
    };

    const withCallMetadata = (result: ProviderResult<unknown>): ProviderResult<unknown> => ({
      ...result,
      metadata: {
        ...result.metadata,
        requestId,
        latencyMs: Date.now() - startTime,
      },
    });

    // Validate field set is in registry
    if (!(args.fieldSet in FIELD_SETS)) {
      return finalize({
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
      });
    }

    const fieldSetKey = args.fieldSet as FieldSetKey;
    const endpointClass = args.endpointClass as EndpointClass;

    // Validate endpoint class
    const validEndpointClasses = Object.values(ENDPOINT_CLASSES);
    if (!validEndpointClasses.includes(endpointClass)) {
      return finalize({
        success: false,
        error: {
          code: "INVALID_ENDPOINT_CLASS",
          message: `Endpoint class '${args.endpointClass}' is not valid. Valid classes: ${validEndpointClasses.join(", ")}`,
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }

    // Check if endpoint class is implemented
    const implementedEndpoints: EndpointClass[] = ["place_details", "text_search", "autocomplete"];
    if (!implementedEndpoints.includes(endpointClass)) {
      return finalize({
        success: false,
        error: {
          code: "ENDPOINT_NOT_IMPLEMENTED",
          message: `Endpoint class '${endpointClass}' is not yet implemented. Currently supported: ${implementedEndpoints.join(", ")}`,
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }

    // Validate required parameters for implemented endpoints
    if (endpointClass === "place_details" && !args.placeId) {
      return finalize({
        success: false,
        error: {
          code: "MISSING_PARAMETER",
          message: "placeId is required for place_details endpoint",
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }
    if (endpointClass === "text_search" && !args.query) {
      return finalize({
        success: false,
        error: {
          code: "MISSING_PARAMETER",
          message: "query is required for text_search endpoint",
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }
    if (endpointClass === "autocomplete" && !args.input) {
      return finalize({
        success: false,
        error: {
          code: "MISSING_PARAMETER",
          message: "input is required for autocomplete endpoint",
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }
    if (endpointClass === "autocomplete" && args.input && args.input.length < 2) {
      return finalize({
        success: false,
        error: {
          code: "INVALID_PARAMETER",
          message: "input must be at least 2 characters for autocomplete",
          retryable: false,
        },
        metadata: {
          requestId,
          latencyMs: Date.now() - startTime,
          costClass: "none",
          fieldSet: fieldSetKey,
          endpointClass,
          cacheHit: false,
        },
      });
    }

    const language = args.language ?? "en";
    const regionCode = args.regionCode ?? "MA";

    // =========================================================================
    // Search Cache Check (text_search only)
    // =========================================================================
    // Check cache BEFORE circuit breaker and budget checks
    // This allows cached responses even when provider is unavailable
    let searchCacheKey: string | null = null;

    if (endpointClass === "text_search" && args.query) {
      searchCacheKey = generateSearchCacheKey({
        query: args.query,
        language,
        locationBias: args.locationBias,
        locationRestriction: args.locationRestriction,
      });

      const cacheResult = await ctx.runQuery(
        internal.searchCache.checkSearchCache,
        { cacheKey: searchCacheKey }
      );

      if (cacheResult.cacheHit) {
        // ID-only cache hits are only safe for callers that can hydrate details separately.
        // UI text-search flows (map/list cards) need full provider fields, so they should
        // continue to provider fetch unless this is explicitly enabled.
        if (args.allowIdOnlySearchCacheResponse) {
          return finalize({
            success: true,
            data: {
              // Format as a search response with just placeKeys
              places: cacheResult.placeKeys.map((key: string) => ({
                placeKey: key,
                // Caller must fetch details separately
              })),
              cachedResult: true,
            },
            metadata: {
              requestId,
              latencyMs: Date.now() - startTime,
              costClass: "none", // Cache hit = no API cost
              fieldSet: fieldSetKey,
              endpointClass,
              cacheHit: true,
            },
          });
        }
      }
    }

    const priorityOverride = args.priority?.trim().toLowerCase();
    const numericPriority = priorityOverride ? Number(priorityOverride) : Number.NaN;
    const mappedPriority =
      priorityOverride === "high"
        ? 1
        : priorityOverride === "normal"
          ? 2
          : priorityOverride === "low"
            ? 3
            : Number.NaN;
    const resolvedPriority: PriorityClass =
      Number.isInteger(numericPriority) &&
      numericPriority >= 1 &&
      numericPriority <= 4
        ? (numericPriority as PriorityClass)
        : Number.isFinite(mappedPriority)
          ? (mappedPriority as PriorityClass)
          : ENDPOINT_TO_PRIORITY[endpointClass] ?? 2;

    // =========================================================================
    // Singleflight Key (request coalescing)
    // =========================================================================
    let singleflightKey: string | null = null;

    if (endpointClass === "place_details" && args.placeId) {
      singleflightKey = `${detailsKey({
        placeId: args.placeId,
        fieldSet: fieldSetKey,
        language,
        region: regionCode,
      })}:p${resolvedPriority}`;
    } else if (endpointClass === "autocomplete" && args.input) {
      const typesForKey =
        args.includedPrimaryTypes ?? ["restaurant", "cafe", "bakery", "food"];
      const typesKey = `|types:${typesForKey.slice().sort().join(",")}`;
      const fieldSetKeySuffix = `|fs:${fieldSetKey}`;
      singleflightKey = `${autocompleteKey({
        input: args.input,
        language,
        region: regionCode,
        locationBias: args.locationBias,
      })}${typesKey}${fieldSetKeySuffix}:p${resolvedPriority}`;
    } else if (endpointClass === "text_search" && searchCacheKey) {
      singleflightKey = `text_search:${regionCode}:${fieldSetKey}:${searchCacheKey}:p${resolvedPriority}`;
    }

    const executeProviderCall = async (): Promise<ProviderResult<unknown>> => {
      // =========================================================================
      // Priority-Based Load Shedding Check
      // =========================================================================
      // Check if this request should be shed based on priority and current load
      // Priority is determined by endpoint class or can be overridden by caller

      // Check if we should shed this request
      const sheddingDecision = await ctx.runQuery(
        internal.providerGateway.checkShouldShed,
        { priority: resolvedPriority, endpointClass }
      );

      if (!sheddingDecision.proceed) {
        // Record the shed event for metrics
        await ctx.runMutation(internal.providerGateway.recordShedEvent, {
          priority: resolvedPriority,
          endpointClass,
          reason: sheddingDecision.reason,
          loadLevel: sheddingDecision.loadLevel,
        });

        // Return appropriate response based on shed reason
        const shedMessage = sheddingDecision.reason === "queue_full"
          ? `Request queue full for priority ${resolvedPriority} - please retry`
          : `Request shed due to high load (level: ${sheddingDecision.loadLevel})`;

        return finalize({
          success: false,
          error: {
            code: "LOAD_SHED",
            message: shedMessage,
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
        });
      }

      // Increment active request count (will be decremented on completion)
      await ctx.runMutation(internal.providerGateway.incrementActiveRequests, {
        priority: resolvedPriority,
      });

      // Helper to ensure we decrement on any exit path
      const decrementOnComplete = async () => {
        try {
          await ctx.runMutation(internal.providerGateway.decrementActiveRequests, {
            priority: resolvedPriority,
          });
        } catch {
          // Ignore decrement errors - better to leak a count than crash
        }
      };

      // Check circuit breaker
      const circuitState = await ctx.runQuery(internal.providerGateway.getCircuitState, {
        service: "google_places",
      });
      if (circuitState === "open") {
        await decrementOnComplete();
        return finalize({
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
        });
      }

      if (circuitState === "half_open") {
        // Allow this request as a test - record the attempt
        await ctx.runMutation(internal.providerGateway.recordHalfOpenAttempt, {
          service: "google_places",
        });
      }

      // Check budget
      if (!args.skipBudgetCheck) {
        const budget = await ctx.runQuery(internal.providerGateway.checkBudget, {
          endpointClass,
        });

        if (!budget.allowed) {
          await decrementOnComplete();
          return finalize({
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
          });
        }
      }

      // Get API key from environment
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        await decrementOnComplete();
        return finalize({
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
        });
      }

      // Build request
      const fieldMask = getFieldMask(fieldSetKey);
      // For autocomplete, session token goes in body, not header
      const sessionTokenForHeader = endpointClass === "autocomplete" ? undefined : args.sessionToken;
      const headers = buildHeaders(apiKey, fieldMask, sessionTokenForHeader);

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
        } else if (args.input && endpointClass === "autocomplete") {
          url = buildPlacesApiUrl("places:autocomplete");
          method = "POST";
          body = JSON.stringify({
            input: args.input,
            languageCode: language,
            regionCode: regionCode,
            // Session token for cost bundling (autocomplete + place details = one charge)
            ...(args.sessionToken && { sessionToken: args.sessionToken }),
            // Filter to food-related place types
            ...(args.includedPrimaryTypes && {
              includedPrimaryTypes: args.includedPrimaryTypes,
            }),
            // Default to Morocco food-related types if not specified
            ...(!args.includedPrimaryTypes && {
              includedPrimaryTypes: ["restaurant", "cafe", "bakery", "food"],
            }),
            // Location bias for relevant results
            ...(args.locationBias && {
              locationBias: {
                circle: {
                  center: {
                    latitude: args.locationBias.lat,
                    longitude: args.locationBias.lng,
                  },
                  radius: args.locationBias.radiusMeters ?? 50000, // 50km default for autocomplete
                },
              },
            }),
          });
        } else {
          // This should never happen - parameter validation above should catch this
          // If we get here, it's a bug in the validation logic
          await decrementOnComplete();
          return finalize({
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Unexpected endpoint/parameter combination - this is a bug",
              retryable: false,
            },
            metadata: {
              requestId,
              latencyMs: Date.now() - startTime,
              costClass: "none",
              fieldSet: fieldSetKey,
              endpointClass,
              cacheHit: false,
            },
          });
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
          // Record circuit breaker failure for server errors
          if (response.status >= 500 || response.status === 429) {
            await ctx.runMutation(internal.providerGateway.recordCircuitFailure, {
              service: "google_places",
            });
          }

          await decrementOnComplete();
          return finalize({
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
          });
        }

        // Record circuit breaker success - this will close the circuit if in half-open
        await ctx.runMutation(internal.providerGateway.recordCircuitSuccess, {
          service: "google_places",
        });

        const data = await response.json();

        // IMPORTANT: Never log the response data!
        // Only return it to the caller

        // =========================================================================
        // Search Cache Write (text_search only)
        // =========================================================================
        // Cache placeKeys for future requests (policy-safe: IDs only, no content)
        if (endpointClass === "text_search" && searchCacheKey) {
          const placeKeys = extractPlaceKeysFromSearchResponse(data, "google");
          if (placeKeys.length > 0) {
            // Write cache asynchronously - don't block response
            ctx.runMutation(internal.searchCache.writeSearchCache, {
              cacheKey: searchCacheKey,
              placeKeys,
              provider: "google",
            }).catch(() => {
              // Ignore cache write failures - they're not critical
            });
          }
        }

        // Request completed successfully - decrement active count
        await decrementOnComplete();

        return finalize({
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
        });
      } catch (error) {
        clearTimeout(timeoutId);

        const isAbort = error instanceof Error && error.name === "AbortError";

        // Record circuit breaker failure for network errors and timeouts
        await ctx.runMutation(internal.providerGateway.recordCircuitFailure, {
          service: "google_places",
        });

        // Decrement active count even on error
        await decrementOnComplete();

        return finalize({
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
        });
      }
    };

    if (!singleflightKey) {
      return await executeProviderCall();
    }

    const { data: result, shared } = await singleflight(
      singleflightKey,
      executeProviderCall
    );

    if (shared) {
      return withCallMetadata(result);
    }

    return result;
  },
});

// ============================================================================
// Public API for Load Monitoring
// ============================================================================

/**
 * Get current load state (for UI display/debugging)
 */
export const getLoadState = query({
  args: {},
  handler: async (ctx): Promise<{
    loadLevel: LoadLevel;
    activeRequests: number;
    maxConcurrent: number;
    loadPercent: number;
    queueDepths: Record<string, number>;
    todayShedCounts: Record<string, number>;
  }> => {
    // Get active request count
    const activeRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", "load:active_requests"))
      .first();

    const activeRequests = activeRecord?.count ?? 0;
    const maxConcurrent = LOAD_SHEDDING_CONFIG.maxConcurrentCalls;
    const loadPercent = (activeRequests / maxConcurrent) * 100;

    // Determine load level
    let loadLevel: LoadLevel;
    const loadRatio = activeRequests / maxConcurrent;
    if (loadRatio >= LOAD_SHEDDING_CONFIG.loadLevels.critical) {
      loadLevel = "critical";
    } else if (loadRatio >= LOAD_SHEDDING_CONFIG.loadLevels.high) {
      loadLevel = "high";
    } else if (loadRatio >= LOAD_SHEDDING_CONFIG.loadLevels.elevated) {
      loadLevel = "elevated";
    } else {
      loadLevel = "normal";
    }

    // Get queue depths
    const queueDepths: Record<string, number> = {};
    for (const priority of [1, 2, 3, 4] as PriorityClass[]) {
      const queueRecord = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `load:queue:${priority}`))
        .first();
      queueDepths[`P${priority}`] = queueRecord?.count ?? 0;
    }

    // Get today's shed counts
    const todayShedCounts: Record<string, number> = {};
    const todayDate = new Date().toISOString().split('T')[0];
    for (const priority of [1, 2, 3, 4] as PriorityClass[]) {
      const shedRecord = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `shed:${priority}:${todayDate}`))
        .first();
      todayShedCounts[`P${priority}`] = shedRecord?.count ?? 0;
    }

    return {
      loadLevel,
      activeRequests,
      maxConcurrent,
      loadPercent,
      queueDepths,
      todayShedCounts,
    };
  },
});

/**
 * USAGE:
 *
 * All provider API calls should use:
 *   await ctx.runAction(internal.providerGateway.providerRequest, { ... })
 *
 * Never call the Google Places API directly!
 *
 * Don't forget to add GOOGLE_PLACES_API_KEY to Convex environment variables.
 */
