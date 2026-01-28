/**
 * Popular Searches with Privacy Guardrails
 *
 * Implements trending searches feature with k-anonymity and PII filtering
 * to prevent privacy leaks through popular query display.
 *
 * Privacy Guardrails:
 * 1. K-Anonymity: Only display queries with ≥20 unique users
 * 2. PII Filtering: Drop queries containing emails, phones, URLs
 * 3. Retention: Raw logs 24h max, aggregates 30-day rolling window
 *
 * Flow:
 * User searches → logRecentSearch (short TTL) → daily cron aggregates
 * → aggregates stored with k-anonymity check → getPopularSearches reads aggregates
 */

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { normalizeQuery } from "../lib/transliteration";

// ============================================================================
// Privacy Configuration
// ============================================================================

/**
 * Minimum unique users required before a query is displayed (k-anonymity)
 * This prevents uniquely identifying queries from appearing in popular searches
 */
const MIN_USERS_FOR_DISPLAY = 20;

/**
 * Raw search log retention (24 hours in milliseconds)
 * Raw per-user queries are deleted after this period
 */
const RAW_LOG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregation period (30 days in milliseconds)
 * Aggregates older than this are purged
 */
const AGGREGATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Maximum query length to prevent abuse
 */
const MAX_QUERY_LENGTH = 200;

// ============================================================================
// PII Detection Patterns
// ============================================================================

/**
 * Email pattern - matches common email formats
 * Catches: user@domain.com, name.surname@company.org
 */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Phone pattern - matches 10+ digit numbers (with optional + prefix)
 * Catches: +212612345678, 0612345678, +1-555-123-4567
 */
const PHONE_PATTERN = /\+?\d[\d\s\-()]{9,}/;

/**
 * URL pattern - matches http/https URLs
 * Catches: http://example.com, https://site.com/path
 */
const URL_PATTERN = /https?:\/\/[^\s]+/i;

/**
 * Moroccan phone patterns - more specific for local numbers
 */
const MOROCCAN_PHONE_PATTERN = /(?:0|\+212)[567]\d{8}/;

/**
 * Check if a query contains potential PII
 *
 * @param query - The search query to check
 * @returns true if PII detected, false if safe
 */
export function containsPII(query: string): boolean {
  return (
    EMAIL_PATTERN.test(query) ||
    PHONE_PATTERN.test(query) ||
    URL_PATTERN.test(query) ||
    MOROCCAN_PHONE_PATTERN.test(query)
  );
}

/**
 * Normalize and sanitize a query for aggregation
 *
 * Operations:
 * 1. Trim and lowercase
 * 2. Apply transliteration normalization
 * 3. Collapse multiple spaces
 * 4. Truncate to max length
 *
 * @param query - Raw user query
 * @returns Normalized query string
 */
export function sanitizeQuery(query: string): string {
  if (!query) return "";

  // Basic cleanup
  let normalized = query.trim().toLowerCase();

  // Apply transliteration (Arabic/French/English variants)
  normalized = normalizeQuery(normalized);

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, " ").trim();

  // Truncate
  if (normalized.length > MAX_QUERY_LENGTH) {
    normalized = normalized.slice(0, MAX_QUERY_LENGTH);
  }

  return normalized;
}

// ============================================================================
// Recent Search Logging
// ============================================================================

/**
 * Log a user's search for aggregation
 *
 * Called after each search. Stores normalized query with user ID
 * for later aggregation. Raw logs are purged after 24 hours.
 */
export const logRecentSearch = mutation({
  args: {
    query: v.string(),
    city: v.optional(v.string()),
    resultCount: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      // Don't log anonymous searches for privacy
      return;
    }

    // Get user from identity
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      return;
    }

    // Skip empty or PII-containing queries
    const normalizedQuery = sanitizeQuery(args.query);
    if (!normalizedQuery || containsPII(args.query)) {
      return;
    }

    await ctx.db.insert("recentSearches", {
      userId: user._id,
      query: args.query,
      normalizedQuery,
      city: args.city,
      resultCount: args.resultCount,
      searchedAt: Date.now(),
    });
  },
});

// ============================================================================
// Aggregation (Internal - called by cron)
// ============================================================================

/**
 * Get distinct normalized queries from recent searches within a time window
 * Internal query used by aggregation cron
 */
export const getQueriesForAggregation = internalQuery({
  args: {
    since: v.number(),
    until: v.number(),
    city: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000;

    // Query recent searches in the time window
    let recentSearches;
    if (args.city) {
      recentSearches = await ctx.db
        .query("recentSearches")
        .withIndex("by_city_searched_at", (q) =>
          q.eq("city", args.city).gte("searchedAt", args.since)
        )
        .filter((q) => q.lte(q.field("searchedAt"), args.until))
        .take(limit);
    } else {
      recentSearches = await ctx.db
        .query("recentSearches")
        .withIndex("by_searched_at", (q) => q.gte("searchedAt", args.since))
        .filter((q) => q.lte(q.field("searchedAt"), args.until))
        .take(limit);
    }

    // Aggregate by normalizedQuery
    const queryStats = new Map<
      string,
      { count: number; uniqueUsers: Set<string> }
    >();

    for (const search of recentSearches) {
      const key = search.normalizedQuery;
      if (!queryStats.has(key)) {
        queryStats.set(key, { count: 0, uniqueUsers: new Set() });
      }
      const stats = queryStats.get(key)!;
      stats.count++;
      stats.uniqueUsers.add(search.userId);
    }

    // Convert to array format
    return Array.from(queryStats.entries()).map(([query, stats]) => ({
      normalizedQuery: query,
      count: stats.count,
      uniqueUsers: stats.uniqueUsers.size,
    }));
  },
});

/**
 * Store aggregated search data with k-anonymity filtering
 * Internal mutation called by aggregation cron
 */
export const storeAggregates = internalMutation({
  args: {
    aggregates: v.array(
      v.object({
        normalizedQuery: v.string(),
        count: v.number(),
        uniqueUsers: v.number(),
      })
    ),
    city: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    // Only store queries that meet k-anonymity threshold
    const filteredAggregates = args.aggregates.filter(
      (agg) => agg.uniqueUsers >= MIN_USERS_FOR_DISPLAY
    );

    for (const agg of filteredAggregates) {
      // Check if aggregate already exists for this query/city
      // Uses by_city_query index for efficient O(1) lookup
      const existing = await ctx.db
        .query("searchAggregates")
        .withIndex("by_city_query", (q) =>
          q.eq("city", args.city).eq("normalizedQuery", agg.normalizedQuery)
        )
        .filter((q) => q.eq(q.field("periodStart"), args.periodStart))
        .first();

      if (existing) {
        // Update existing aggregate
        await ctx.db.patch(existing._id, {
          count: existing.count + agg.count,
          uniqueUsers: existing.uniqueUsers + agg.uniqueUsers,
        });
      } else {
        // Insert new aggregate
        await ctx.db.insert("searchAggregates", {
          normalizedQuery: agg.normalizedQuery,
          city: args.city,
          count: agg.count,
          uniqueUsers: agg.uniqueUsers,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
        });
      }
    }

    return { stored: filteredAggregates.length };
  },
});

/**
 * Purge raw search logs older than 24 hours
 * Internal mutation called by cleanup cron
 */
export const purgeOldSearchLogs = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    const cutoff = Date.now() - RAW_LOG_TTL_MS;

    // Find old logs
    const oldLogs = await ctx.db
      .query("recentSearches")
      .withIndex("by_searched_at", (q) => q.lt("searchedAt", cutoff))
      .take(batchSize);

    // Delete them
    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
    }

    return { deleted: oldLogs.length };
  },
});

/**
 * Purge old aggregates (beyond 30-day retention)
 * Internal mutation called by cleanup cron
 */
export const purgeOldAggregates = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    const cutoff = Date.now() - AGGREGATE_RETENTION_MS;

    // Find old aggregates
    const oldAggregates = await ctx.db
      .query("searchAggregates")
      .withIndex("by_period", (q) => q.lt("periodStart", cutoff))
      .take(batchSize);

    // Delete them
    for (const agg of oldAggregates) {
      await ctx.db.delete(agg._id);
    }

    return { deleted: oldAggregates.length };
  },
});

/**
 * Run daily aggregation
 * Aggregates searches from the last 24 hours by city
 * Internal mutation called by daily cron
 */
export const runDailyAggregation = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const periodEnd = now;
    const periodStart = now - RAW_LOG_TTL_MS; // Last 24 hours

    // Get all cities with recent searches
    const recentSearches = await ctx.db
      .query("recentSearches")
      .withIndex("by_searched_at", (q) => q.gte("searchedAt", periodStart))
      .take(10000);

    // Get unique cities
    const cities = new Set<string>();
    cities.add("global"); // Always aggregate global
    for (const search of recentSearches) {
      if (search.city) {
        cities.add(search.city);
      }
    }

    // Note: In production, this would call getQueriesForAggregation and storeAggregates
    // via scheduler for each city to avoid timeout. For simplicity, we aggregate inline.

    let totalStored = 0;

    for (const city of cities) {
      // Aggregate queries for this city
      const queryStats = new Map<
        string,
        { count: number; uniqueUsers: Set<string> }
      >();

      for (const search of recentSearches) {
        // Match city (or all for global)
        if (city !== "global" && search.city !== city) continue;

        const key = search.normalizedQuery;
        if (!queryStats.has(key)) {
          queryStats.set(key, { count: 0, uniqueUsers: new Set() });
        }
        const stats = queryStats.get(key)!;
        stats.count++;
        stats.uniqueUsers.add(search.userId);
      }

      // Store aggregates (only those meeting k-anonymity threshold)
      for (const [normalizedQuery, stats] of queryStats.entries()) {
        if (stats.uniqueUsers.size < MIN_USERS_FOR_DISPLAY) continue;

        // Check if aggregate already exists for this query/city
        // Uses by_city_query index for efficient O(1) lookup
        const existing = await ctx.db
          .query("searchAggregates")
          .withIndex("by_city_query", (q) =>
            q.eq("city", city).eq("normalizedQuery", normalizedQuery)
          )
          .first();

        if (existing) {
          // Update count (merge with existing)
          await ctx.db.patch(existing._id, {
            count: existing.count + stats.count,
            uniqueUsers: existing.uniqueUsers + stats.uniqueUsers.size,
            periodEnd,
          });
        } else {
          // Insert new
          await ctx.db.insert("searchAggregates", {
            normalizedQuery,
            city,
            count: stats.count,
            uniqueUsers: stats.uniqueUsers.size,
            periodStart,
            periodEnd,
          });
        }
        totalStored++;
      }
    }

    return {
      citiesProcessed: cities.size,
      aggregatesStored: totalStored,
    };
  },
});

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get popular searches for a city
 *
 * Returns trending searches that:
 * 1. Meet k-anonymity threshold (≥20 unique users)
 * 2. Are within the 30-day retention window
 * 3. Don't contain PII (filtered at aggregation time)
 *
 * @param city - City slug (or "global" for all cities)
 * @param limit - Max results (default 10)
 */
export const getPopularSearches = query({
  args: {
    city: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const city = args.city ?? "global";
    const limit = args.limit ?? 10;

    // Query aggregates by city, ordered by count descending
    const aggregates = await ctx.db
      .query("searchAggregates")
      .withIndex("by_city_count", (q) => q.eq("city", city))
      .order("desc")
      .take(limit * 2); // Over-fetch to handle filtering

    // Filter to only those meeting k-anonymity threshold (should already be filtered, but double-check)
    const filtered = aggregates
      .filter((agg) => agg.uniqueUsers >= MIN_USERS_FOR_DISPLAY)
      .slice(0, limit);

    return filtered.map((agg) => ({
      query: agg.normalizedQuery,
      count: agg.count,
      // Don't expose exact uniqueUsers count for privacy
    }));
  },
});

/**
 * Get user's recent searches
 *
 * Returns the current user's own recent searches (not aggregated)
 * Limited to last 10 searches
 */
export const getMyRecentSearches = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      return [];
    }

    const limit = args.limit ?? 10;

    const recentSearches = await ctx.db
      .query("recentSearches")
      .withIndex("by_user_recent", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return recentSearches.map((search) => ({
      query: search.query,
      normalizedQuery: search.normalizedQuery,
      city: search.city,
      searchedAt: search.searchedAt,
    }));
  },
});

/**
 * Delete a user's search history
 *
 * Allows users to clear their own search history
 */
export const clearMySearchHistory = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { deleted: 0 };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      return { deleted: 0 };
    }

    // Get all user's recent searches
    const searches = await ctx.db
      .query("recentSearches")
      .withIndex("by_user_recent", (q) => q.eq("userId", user._id))
      .collect();

    // Delete them
    for (const search of searches) {
      await ctx.db.delete(search._id);
    }

    return { deleted: searches.length };
  },
});
