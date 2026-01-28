/**
 * Search Result Cache - ID-only caching for provider searches
 *
 * This module implements policy-safe caching of search results:
 * - Stores ONLY placeKeys (IDs), never provider content
 * - Short TTL (15 minutes) to balance freshness vs cost
 * - Deterministic cache keys for consistent lookups
 *
 * Cache Flow:
 * 1. Search request comes in
 * 2. Generate cache key from normalized params
 * 3. Check cache - if hit, return placeKeys (caller fetches fresh details)
 * 4. If miss, caller performs search, then writes placeKeys to cache
 */

import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL in milliseconds (15 minutes)
 * Short TTL because:
 * - Place rankings can change with new reviews
 * - New places can be added
 * - But place existence rarely changes
 */
export const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Maximum entries to return from cache (prevent unbounded responses)
 */
const MAX_CACHED_RESULTS = 50;

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Parameters used for cache key generation
 */
interface CacheKeyParams {
  query: string;
  city?: string;
  language?: string;
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
  locationRestriction?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

/**
 * Normalize query for cache key (lowercase, trim, collapse whitespace)
 */
function normalizeQueryForCache(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Round coordinates to reduce cache fragmentation
 * Rounds to ~100m precision (3 decimal places)
 */
function roundCoordinate(coord: number): number {
  return Math.round(coord * 1000) / 1000;
}

/**
 * Generate a deterministic cache key from search parameters
 *
 * Uses a simple but effective approach:
 * - Normalize all inputs
 * - Sort keys for determinism
 * - Join with separator
 *
 * Note: Using simple string concatenation instead of hash because:
 * 1. Convex doesn't have built-in crypto
 * 2. String keys are efficient in Convex indexes
 * 3. Keys are human-readable for debugging
 */
export function generateSearchCacheKey(params: CacheKeyParams): string {
  const parts: string[] = [];

  // Query (normalized)
  parts.push(`q:${normalizeQueryForCache(params.query)}`);

  // City (optional)
  if (params.city) {
    parts.push(`c:${params.city.toLowerCase()}`);
  }

  // Language
  parts.push(`l:${params.language || "en"}`);

  // Location bias (rounded for cache efficiency)
  if (params.locationBias) {
    const lat = roundCoordinate(params.locationBias.lat);
    const lng = roundCoordinate(params.locationBias.lng);
    const radius = params.locationBias.radiusMeters ?? 5000;
    parts.push(`lb:${lat},${lng},${radius}`);
  }

  // Location restriction (bounding box, rounded)
  if (params.locationRestriction) {
    const n = roundCoordinate(params.locationRestriction.north);
    const s = roundCoordinate(params.locationRestriction.south);
    const e = roundCoordinate(params.locationRestriction.east);
    const w = roundCoordinate(params.locationRestriction.west);
    parts.push(`lr:${n},${s},${e},${w}`);
  }

  return parts.join("|");
}

// ============================================================================
// Cache Operations (Internal Functions)
// ============================================================================

/**
 * Check cache for search results
 *
 * Returns placeKeys if cache hit and not expired, null otherwise
 */
export const checkSearchCache = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ placeKeys: string[]; cacheHit: true } | { cacheHit: false }> => {
    const now = Date.now();

    const cached = await ctx.db
      .query("searchResultCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (!cached) {
      return { cacheHit: false };
    }

    // Check if expired
    if (cached.expiresAt <= now) {
      // Don't delete here - let the purge job handle cleanup
      return { cacheHit: false };
    }

    return {
      placeKeys: cached.placeKeys.slice(0, MAX_CACHED_RESULTS),
      cacheHit: true,
    };
  },
});

/**
 * Write search results to cache
 *
 * Only stores placeKeys (IDs), never provider content
 */
export const writeSearchCache = internalMutation({
  args: {
    cacheKey: v.string(),
    placeKeys: v.array(v.string()),
    provider: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();

    // Check if entry already exists
    const existing = await ctx.db
      .query("searchResultCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        placeKeys: args.placeKeys.slice(0, MAX_CACHED_RESULTS),
        expiresAt: now + SEARCH_CACHE_TTL_MS,
      });
    } else {
      // Create new entry
      await ctx.db.insert("searchResultCache", {
        cacheKey: args.cacheKey,
        placeKeys: args.placeKeys.slice(0, MAX_CACHED_RESULTS),
        provider: args.provider,
        expiresAt: now + SEARCH_CACHE_TTL_MS,
        createdAt: now,
      });
    }
  },
});

/**
 * Purge expired cache entries
 *
 * Called by scheduled job (see crons.ts)
 */
export const purgeExpiredSearchCache = internalMutation({
  handler: async (ctx): Promise<{ deleted: number }> => {
    const now = Date.now();
    let deleted = 0;

    // Get expired entries
    const expired = await ctx.db
      .query("searchResultCache")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
      .take(100); // Batch size to prevent long-running mutations

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted };
  },
});

/**
 * Get cache stats for monitoring
 */
export const getSearchCacheStats = internalQuery({
  handler: async (ctx): Promise<{
    totalEntries: number;
    expiredEntries: number;
    oldestEntry: number | null;
  }> => {
    const now = Date.now();
    const allEntries = await ctx.db.query("searchResultCache").collect();

    const expiredEntries = allEntries.filter((e) => e.expiresAt <= now).length;
    const oldestEntry = allEntries.length > 0
      ? Math.min(...allEntries.map((e) => e.createdAt))
      : null;

    return {
      totalEntries: allEntries.length,
      expiredEntries,
      oldestEntry,
    };
  },
});

// ============================================================================
// Helper for ProviderGateway Integration
// ============================================================================

/**
 * Extract placeKeys from a text search response
 *
 * This normalizes the provider response format to just IDs
 */
export function extractPlaceKeysFromSearchResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
  provider: string = "google"
): string[] {
  if (!response || !response.places) {
    return [];
  }

  return response.places
    .map((place: { name?: string; id?: string }) => {
      // Google Places API returns place.name as "places/{placeId}"
      // Extract the ID and format as placeKey
      if (place.name && place.name.startsWith("places/")) {
        const placeId = place.name.replace("places/", "");
        return `g:${placeId}`;
      }
      // Alternative: direct ID field
      if (place.id) {
        return `${provider === "google" ? "g" : provider}:${place.id}`;
      }
      return null;
    })
    .filter((key: string | null): key is string => key !== null);
}
