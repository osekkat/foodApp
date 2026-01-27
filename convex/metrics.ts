/**
 * Metrics Collection & Dashboard Support
 *
 * This module provides observability for:
 * - Performance: Search/detail latency (P50, P95, P99)
 * - Cost: API calls by endpoint, cache hit rates
 * - Business: CTR, conversions, engagement
 *
 * Metrics are recorded at two levels:
 * 1. Raw events (metrics table) - for detailed analysis
 * 2. Aggregates (metricsAggregates table) - for dashboards
 *
 * IMPORTANT: Never log provider content in metric tags.
 * Only log safe metadata: endpoint class, cost tier, cache hit, etc.
 */

import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ============================================================================
// Types & Configuration
// ============================================================================

/**
 * Metric names (for type safety and consistency)
 */
export const METRIC_NAMES = {
  // Performance metrics
  SEARCH_LATENCY: "search_latency",
  PLACE_DETAIL_LATENCY: "place_detail_latency",
  AUTOCOMPLETE_LATENCY: "autocomplete_latency",

  // Cost metrics
  API_CALL: "api_call",
  CACHE_HIT: "cache_hit",
  CACHE_MISS: "cache_miss",
  BUDGET_USAGE: "budget_usage",

  // Business metrics
  SEARCH_PERFORMED: "search_performed",
  PLACE_VIEWED: "place_viewed",
  FAVORITE_TOGGLED: "favorite_toggled",
  REVIEW_CREATED: "review_created",

  // System metrics
  SERVICE_MODE_CHANGE: "service_mode_change",
  CIRCUIT_BREAKER_TRIP: "circuit_breaker_trip",
  ERROR_RATE: "error_rate",
} as const;

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

/**
 * Metric tags for filtering/grouping
 */
export interface MetricTags {
  endpoint?: string;
  costTier?: string;
  cacheHit?: boolean;
  serviceMode?: number;
  city?: string;
}

/**
 * Aggregation periods
 */
export type AggregationPeriod = "hour" | "day";

// ============================================================================
// Recording Functions
// ============================================================================

/**
 * Record a raw metric event
 * Use for detailed tracking - aggregation happens separately
 */
export const record = internalMutation({
  args: {
    name: v.string(),
    value: v.number(),
    tags: v.optional(
      v.object({
        endpoint: v.optional(v.string()),
        costTier: v.optional(v.string()),
        cacheHit: v.optional(v.boolean()),
        serviceMode: v.optional(v.number()),
        city: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("metrics", {
      name: args.name,
      value: args.value,
      tags: args.tags,
      timestamp: Date.now(),
    });
  },
});

/**
 * Record a latency metric with endpoint tag
 */
export const recordLatency = internalMutation({
  args: {
    endpoint: v.string(),
    latencyMs: v.number(),
    cacheHit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const metricName =
      args.endpoint === "text_search"
        ? METRIC_NAMES.SEARCH_LATENCY
        : args.endpoint === "place_details"
          ? METRIC_NAMES.PLACE_DETAIL_LATENCY
          : METRIC_NAMES.AUTOCOMPLETE_LATENCY;

    await ctx.db.insert("metrics", {
      name: metricName,
      value: args.latencyMs,
      tags: {
        endpoint: args.endpoint,
        cacheHit: args.cacheHit,
      },
      timestamp: Date.now(),
    });
  },
});

/**
 * Record an API call (for cost tracking)
 */
export const recordApiCall = internalMutation({
  args: {
    endpoint: v.string(),
    costTier: v.string(),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("metrics", {
      name: METRIC_NAMES.API_CALL,
      value: args.cost,
      tags: {
        endpoint: args.endpoint,
        costTier: args.costTier,
      },
      timestamp: Date.now(),
    });
  },
});

/**
 * Record cache hit/miss
 */
export const recordCacheEvent = internalMutation({
  args: {
    endpoint: v.string(),
    hit: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("metrics", {
      name: args.hit ? METRIC_NAMES.CACHE_HIT : METRIC_NAMES.CACHE_MISS,
      value: 1,
      tags: {
        endpoint: args.endpoint,
        cacheHit: args.hit,
      },
      timestamp: Date.now(),
    });
  },
});

/**
 * Record a business event (search, view, favorite, review)
 */
export const recordBusinessEvent = internalMutation({
  args: {
    event: v.string(), // One of: search_performed, place_viewed, favorite_toggled, review_created
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("metrics", {
      name: args.event,
      value: 1,
      tags: args.city ? { city: args.city } : undefined,
      timestamp: Date.now(),
    });
  },
});

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get recent metrics by name
 */
export const getRecentMetrics = query({
  args: {
    name: v.string(),
    limit: v.optional(v.number()),
    sinceMsAgo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const sinceTime = args.sinceMsAgo ? Date.now() - args.sinceMsAgo : 0;

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) =>
        sinceTime > 0 ? q.eq("name", args.name).gte("timestamp", sinceTime) : q.eq("name", args.name)
      )
      .order("desc")
      .take(limit);

    return metrics;
  },
});

/**
 * Get metric summary (count, avg, min, max) for a time window
 */
export const getMetricSummary = query({
  args: {
    name: v.string(),
    sinceMsAgo: v.number(), // e.g. 3600000 for last hour
  },
  handler: async (ctx, args) => {
    const sinceTime = Date.now() - args.sinceMsAgo;

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) => q.eq("name", args.name).gte("timestamp", sinceTime))
      .collect();

    if (metrics.length === 0) {
      return {
        count: 0,
        sum: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const values = metrics.map((m) => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    // Calculate percentiles
    const p50Index = Math.floor(values.length * 0.5);
    const p95Index = Math.floor(values.length * 0.95);
    const p99Index = Math.floor(values.length * 0.99);

    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: values[p50Index] ?? 0,
      p95: values[p95Index] ?? values[values.length - 1],
      p99: values[p99Index] ?? values[values.length - 1],
    };
  },
});

/**
 * Get cache hit rate for a time window
 */
export const getCacheHitRate = query({
  args: {
    endpoint: v.optional(v.string()),
    sinceMsAgo: v.number(),
  },
  handler: async (ctx, args) => {
    const sinceTime = Date.now() - args.sinceMsAgo;

    // Get all cache events
    const hits = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) => q.eq("name", METRIC_NAMES.CACHE_HIT).gte("timestamp", sinceTime))
      .collect();

    const misses = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) => q.eq("name", METRIC_NAMES.CACHE_MISS).gte("timestamp", sinceTime))
      .collect();

    // Filter by endpoint if specified
    const filteredHits = args.endpoint ? hits.filter((m) => m.tags?.endpoint === args.endpoint) : hits;
    const filteredMisses = args.endpoint ? misses.filter((m) => m.tags?.endpoint === args.endpoint) : misses;

    const total = filteredHits.length + filteredMisses.length;

    return {
      hits: filteredHits.length,
      misses: filteredMisses.length,
      total,
      hitRate: total > 0 ? filteredHits.length / total : 0,
    };
  },
});

/**
 * Get API cost summary by endpoint
 */
export const getApiCostSummary = query({
  args: {
    sinceMsAgo: v.number(),
  },
  handler: async (ctx, args) => {
    const sinceTime = Date.now() - args.sinceMsAgo;

    const apiCalls = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) => q.eq("name", METRIC_NAMES.API_CALL).gte("timestamp", sinceTime))
      .collect();

    // Group by endpoint
    const byEndpoint: Record<string, { count: number; totalCost: number }> = {};

    for (const call of apiCalls) {
      const endpoint = call.tags?.endpoint ?? "unknown";
      if (!byEndpoint[endpoint]) {
        byEndpoint[endpoint] = { count: 0, totalCost: 0 };
      }
      byEndpoint[endpoint].count++;
      byEndpoint[endpoint].totalCost += call.value;
    }

    const totalCost = apiCalls.reduce((sum, c) => sum + c.value, 0);

    return {
      byEndpoint,
      totalCalls: apiCalls.length,
      totalCost,
    };
  },
});

/**
 * Get latency percentiles by endpoint
 */
export const getLatencyPercentiles = query({
  args: {
    endpoint: v.string(),
    sinceMsAgo: v.number(),
  },
  handler: async (ctx, args) => {
    const sinceTime = Date.now() - args.sinceMsAgo;

    // Determine metric name based on endpoint
    const metricName =
      args.endpoint === "text_search"
        ? METRIC_NAMES.SEARCH_LATENCY
        : args.endpoint === "place_details"
          ? METRIC_NAMES.PLACE_DETAIL_LATENCY
          : METRIC_NAMES.AUTOCOMPLETE_LATENCY;

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) => q.eq("name", metricName).gte("timestamp", sinceTime))
      .collect();

    // Filter by endpoint tag
    const filtered = metrics.filter((m) => m.tags?.endpoint === args.endpoint);

    if (filtered.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0 };
    }

    const values = filtered.map((m) => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    const p50Index = Math.floor(values.length * 0.5);
    const p95Index = Math.floor(values.length * 0.95);
    const p99Index = Math.floor(values.length * 0.99);

    return {
      count: values.length,
      p50: values[p50Index] ?? 0,
      p95: values[p95Index] ?? values[values.length - 1],
      p99: values[p99Index] ?? values[values.length - 1],
      avg: sum / values.length,
    };
  },
});

// ============================================================================
// Dashboard Aggregation
// ============================================================================

/**
 * Get dashboard summary with key metrics
 */
export const getDashboardSummary = query({
  handler: async (ctx) => {
    const oneHourAgo = 3600000;
    const oneDayAgo = 86400000;

    // Get recent metrics counts
    const recentMetrics = await ctx.db
      .query("metrics")
      .withIndex("by_time", (q) => q.gte("timestamp", Date.now() - oneHourAgo))
      .collect();

    // Count by type
    const byName: Record<string, number> = {};
    for (const m of recentMetrics) {
      byName[m.name] = (byName[m.name] ?? 0) + 1;
    }

    // Get service mode
    const serviceMode = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    return {
      lastHour: {
        totalEvents: recentMetrics.length,
        byMetric: byName,
      },
      serviceMode: serviceMode
        ? {
            currentMode: serviceMode.currentMode,
            reason: serviceMode.reason,
            enteredAt: serviceMode.enteredAt,
          }
        : { currentMode: 0, reason: "not_initialized" },
    };
  },
});

// ============================================================================
// Cleanup / Maintenance
// ============================================================================

/**
 * Delete old raw metrics (retention: 7 days by default)
 * Call from a scheduled job
 */
export const cleanupOldMetrics = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retentionMs = (args.retentionDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;

    // Get old metrics in batches
    const oldMetrics = await ctx.db
      .query("metrics")
      .withIndex("by_time", (q) => q.lt("timestamp", cutoff))
      .take(1000); // Process in batches

    for (const metric of oldMetrics) {
      await ctx.db.delete(metric._id);
    }

    return { deleted: oldMetrics.length };
  },
});
