/**
 * Map Tile Cache - ID-only caching for map viewport searches
 *
 * This module implements policy-safe caching of map tile place IDs:
 * - Stores ONLY placeKeys (IDs), never provider content
 * - Uses geohash-based tile keys for spatial indexing
 * - Longer TTL than search cache (places don't move)
 * - Chunking support for tiles with many places
 *
 * Cache Flow:
 * 1. Map viewport changes
 * 2. Calculate visible tiles from bounds
 * 3. Check mapTileCache for each tile
 * 4. HIT: Return cached placeKeys, fetch fresh details for visible ones
 * 5. MISS: Search provider within tile bounds, cache placeKeys, return
 *
 * Why Tile-Based Caching:
 * - Map pans generate lots of "search this area" calls
 * - Multiple users panning same area = multiplied calls
 * - Popular areas (Jemaa el-Fna, Casablanca Marina) get hammered
 * - Tile cache reduces redundant provider calls by 70%+
 */

import { internalQuery, internalMutation, query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL in milliseconds (45 minutes)
 * Longer than search cache because:
 * - Places don't physically move
 * - New places opening is rare (daily, not hourly)
 * - Stale tile data has low user impact (just missing newest places)
 */
export const MAP_TILE_CACHE_TTL_MS = 45 * 60 * 1000;

/**
 * Maximum placeKeys per chunk to avoid oversized documents
 * Large tiles (zoomed out) might have 1000+ places
 */
const MAX_PLACE_KEYS_PER_CHUNK = 100;

/**
 * Maximum chunks to store per tile (prevent runaway storage)
 */
const MAX_CHUNKS_PER_TILE = 10;

/**
 * Geohash precision based on zoom level
 * Higher precision = smaller tiles
 */
const ZOOM_TO_GEOHASH_PRECISION: Record<number, number> = {
  // Zoom 5-7: Very zoomed out, use coarse tiles (precision 3 = ~156km)
  5: 3,
  6: 3,
  7: 3,
  // Zoom 8-10: City level, use medium tiles (precision 4 = ~39km)
  8: 4,
  9: 4,
  10: 4,
  // Zoom 11-13: Neighborhood level (precision 5 = ~5km)
  11: 5,
  12: 5,
  13: 5,
  // Zoom 14-16: Street level (precision 6 = ~1.2km)
  14: 6,
  15: 6,
  16: 6,
  // Zoom 17+: Very zoomed in (precision 7 = ~150m)
  17: 7,
  18: 7,
  19: 7,
  20: 7,
};

// ============================================================================
// Geohash Implementation (Lightweight, no external dependencies)
// ============================================================================

/**
 * Base32 alphabet for geohash encoding
 */
const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encode lat/lng to geohash string
 *
 * Geohash divides the world into a grid of cells, each identified by a string.
 * Longer strings = smaller, more precise cells.
 *
 * @param lat Latitude (-90 to 90)
 * @param lng Longitude (-180 to 180)
 * @param precision Number of characters in geohash (1-12)
 * @returns Geohash string
 */
export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  let latMin = -90,
    latMax = 90;
  let lngMin = -180,
    lngMax = 180;
  let hash = "";
  let isLng = true; // Alternate between lng and lat bits
  let bits = 0;
  let charIndex = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        charIndex = charIndex * 2 + 1;
        lngMin = mid;
      } else {
        charIndex = charIndex * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charIndex = charIndex * 2 + 1;
        latMin = mid;
      } else {
        charIndex = charIndex * 2;
        latMax = mid;
      }
    }

    isLng = !isLng;
    bits++;

    if (bits === 5) {
      hash += GEOHASH_ALPHABET[charIndex];
      bits = 0;
      charIndex = 0;
    }
  }

  return hash;
}

/**
 * Decode geohash to bounding box
 *
 * @param geohash Geohash string
 * @returns Bounding box { north, south, east, west }
 */
export function decodeGeohashBounds(geohash: string): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  let latMin = -90,
    latMax = 90;
  let lngMin = -180,
    lngMax = 180;
  let isLng = true;

  for (const char of geohash.toLowerCase()) {
    const charIndex = GEOHASH_ALPHABET.indexOf(char);
    if (charIndex === -1) continue;

    for (let bits = 4; bits >= 0; bits--) {
      const bit = (charIndex >> bits) & 1;
      if (isLng) {
        const mid = (lngMin + lngMax) / 2;
        if (bit === 1) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      isLng = !isLng;
    }
  }

  return {
    north: latMax,
    south: latMin,
    east: lngMax,
    west: lngMin,
  };
}

/**
 * Get neighboring geohashes (for edge cases near tile boundaries)
 *
 * @param geohash Center geohash
 * @returns Array of 8 neighboring geohashes + center
 */
export function getGeohashNeighbors(geohash: string): string[] {
  const bounds = decodeGeohashBounds(geohash);
  const precision = geohash.length;

  // Calculate center and offsets
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const latOffset = (bounds.north - bounds.south) * 0.9;
  const lngOffset = (bounds.east - bounds.west) * 0.9;

  // Generate neighbors by offsetting center
  const neighbors: string[] = [geohash]; // Include center

  const offsets = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];

  for (const [latMult, lngMult] of offsets) {
    const newLat = centerLat + latOffset * latMult;
    const newLng = centerLng + lngOffset * lngMult;

    // Clamp to valid range
    if (newLat >= -90 && newLat <= 90 && newLng >= -180 && newLng <= 180) {
      neighbors.push(encodeGeohash(newLat, newLng, precision));
    }
  }

  // Deduplicate (edge cases might produce same geohash)
  return [...new Set(neighbors)];
}

// ============================================================================
// Tile Key Generation
// ============================================================================

/**
 * Get geohash precision for a given zoom level
 */
export function getGeohashPrecision(zoom: number): number {
  // Clamp zoom to known range
  const clampedZoom = Math.max(5, Math.min(20, Math.round(zoom)));

  return ZOOM_TO_GEOHASH_PRECISION[clampedZoom] ?? 5;
}

/**
 * Generate a tile key from coordinates and zoom level
 *
 * Format: "gh:{precision}:{geohash}"
 * Example: "gh:5:ezjmg"
 *
 * @param lat Latitude
 * @param lng Longitude
 * @param zoom Map zoom level
 * @returns Tile key string
 */
export function generateTileKey(lat: number, lng: number, zoom: number): string {
  const precision = getGeohashPrecision(zoom);
  const geohash = encodeGeohash(lat, lng, precision);
  return `gh:${precision}:${geohash}`;
}

/**
 * Get all tile keys that intersect with a bounding box
 *
 * @param bounds Map viewport bounds
 * @param zoom Map zoom level
 * @returns Array of tile keys covering the viewport
 */
export function getTileKeysForBounds(
  bounds: { north: number; south: number; east: number; west: number },
  zoom: number
): string[] {
  const precision = getGeohashPrecision(zoom);

  // Get geohash at each corner and center
  const points = [
    { lat: bounds.north, lng: bounds.west }, // NW
    { lat: bounds.north, lng: bounds.east }, // NE
    { lat: bounds.south, lng: bounds.west }, // SW
    { lat: bounds.south, lng: bounds.east }, // SE
    { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }, // Center
  ];

  const tileKeys = new Set<string>();

  for (const point of points) {
    const geohash = encodeGeohash(point.lat, point.lng, precision);
    const key = `gh:${precision}:${geohash}`;
    tileKeys.add(key);

    // Also add neighbors to ensure full coverage at boundaries
    for (const neighbor of getGeohashNeighbors(geohash)) {
      tileKeys.add(`gh:${precision}:${neighbor}`);
    }
  }

  return Array.from(tileKeys);
}

/**
 * Parse a tile key to extract components
 */
export function parseTileKey(tileKey: string): {
  precision: number;
  geohash: string;
  bounds: { north: number; south: number; east: number; west: number };
} | null {
  const match = tileKey.match(/^gh:(\d+):([0-9bcdefghjkmnpqrstuvwxyz]+)$/);
  if (!match) return null;

  const precision = parseInt(match[1], 10);
  const geohash = match[2];
  const bounds = decodeGeohashBounds(geohash);

  return { precision, geohash, bounds };
}

// ============================================================================
// Cache Operations (Internal Functions)
// ============================================================================

/**
 * Check cache for tile data
 *
 * Returns placeKeys if cache hit and not expired, null otherwise.
 * Handles chunked data by collecting all chunks for a tile.
 */
export const checkTileCache = internalQuery({
  args: {
    tileKey: v.string(),
    zoom: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ placeKeys: string[]; cacheHit: true } | { cacheHit: false }> => {
    const now = Date.now();

    // Get all chunks for this tile
    const chunks = await ctx.db
      .query("mapTileCache")
      .withIndex("by_tile", (q) =>
        q.eq("tileKey", args.tileKey).eq("zoom", args.zoom)
      )
      .collect();

    if (chunks.length === 0) {
      return { cacheHit: false };
    }

    // Check if any chunk is expired (if so, treat entire tile as miss)
    const hasExpired = chunks.some((chunk) => chunk.expiresAt <= now);
    if (hasExpired) {
      return { cacheHit: false };
    }

    // Combine placeKeys from all chunks
    const allPlaceKeys: string[] = [];
    for (const chunk of chunks.sort((a, b) => a.chunk - b.chunk)) {
      allPlaceKeys.push(...chunk.placeKeys);
    }

    return {
      placeKeys: allPlaceKeys,
      cacheHit: true,
    };
  },
});

/**
 * Check multiple tiles at once (batch operation)
 *
 * More efficient than checking tiles one by one
 */
export const checkTileCacheBatch = internalQuery({
  args: {
    tiles: v.array(
      v.object({
        tileKey: v.string(),
        zoom: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    hits: Array<{ tileKey: string; placeKeys: string[] }>;
    misses: Array<{ tileKey: string; zoom: number }>;
  }> => {
    const now = Date.now();
    const hits: Array<{ tileKey: string; placeKeys: string[] }> = [];
    const misses: Array<{ tileKey: string; zoom: number }> = [];

    for (const tile of args.tiles) {
      const chunks = await ctx.db
        .query("mapTileCache")
        .withIndex("by_tile", (q) =>
          q.eq("tileKey", tile.tileKey).eq("zoom", tile.zoom)
        )
        .collect();

      if (chunks.length === 0 || chunks.some((c) => c.expiresAt <= now)) {
        misses.push(tile);
      } else {
        const placeKeys = chunks
          .sort((a, b) => a.chunk - b.chunk)
          .flatMap((c) => c.placeKeys);
        hits.push({ tileKey: tile.tileKey, placeKeys });
      }
    }

    return { hits, misses };
  },
});

/**
 * Write tile data to cache with chunking support
 *
 * Handles large result sets by splitting into multiple chunks.
 * Only stores placeKeys (IDs), never provider content.
 */
export const writeTileCache = internalMutation({
  args: {
    tileKey: v.string(),
    zoom: v.number(),
    placeKeys: v.array(v.string()),
    provider: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    const expiresAt = now + MAP_TILE_CACHE_TTL_MS;

    // Delete existing chunks for this tile (full refresh)
    const existingChunks = await ctx.db
      .query("mapTileCache")
      .withIndex("by_tile", (q) =>
        q.eq("tileKey", args.tileKey).eq("zoom", args.zoom)
      )
      .collect();

    for (const chunk of existingChunks) {
      await ctx.db.delete(chunk._id);
    }

    // Split placeKeys into chunks
    const totalPlaceKeys = args.placeKeys.slice(0, MAX_PLACE_KEYS_PER_CHUNK * MAX_CHUNKS_PER_TILE);
    const numChunks = Math.max(1, Math.ceil(totalPlaceKeys.length / MAX_PLACE_KEYS_PER_CHUNK));

    for (let i = 0; i < numChunks; i++) {
      const start = i * MAX_PLACE_KEYS_PER_CHUNK;
      const end = Math.min(start + MAX_PLACE_KEYS_PER_CHUNK, totalPlaceKeys.length);
      const chunkPlaceKeys = totalPlaceKeys.slice(start, end);

      await ctx.db.insert("mapTileCache", {
        tileKey: args.tileKey,
        zoom: args.zoom,
        chunk: i,
        provider: args.provider,
        placeKeys: chunkPlaceKeys,
        expiresAt,
        createdAt: now,
      });
    }
  },
});

/**
 * Purge expired tile cache entries
 *
 * Called by scheduled job (see crons.ts)
 */
export const purgeExpiredTileCache = internalMutation({
  handler: async (ctx): Promise<{ deleted: number }> => {
    const now = Date.now();
    let deleted = 0;

    // Get expired entries (batch size to prevent long-running mutations)
    const expired = await ctx.db
      .query("mapTileCache")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
      .take(100);

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted };
  },
});

/**
 * Get tile cache stats for monitoring
 */
export const getTileCacheStats = internalQuery({
  handler: async (ctx): Promise<{
    totalChunks: number;
    uniqueTiles: number;
    expiredChunks: number;
    avgPlaceKeysPerTile: number;
  }> => {
    const now = Date.now();
    const allChunks = await ctx.db.query("mapTileCache").collect();

    // Count unique tiles
    const uniqueTiles = new Set(
      allChunks.map((c) => `${c.tileKey}:${c.zoom}`)
    ).size;

    // Count expired
    const expiredChunks = allChunks.filter((c) => c.expiresAt <= now).length;

    // Calculate average placeKeys per tile
    const placeKeysByTile = new Map<string, number>();
    for (const chunk of allChunks) {
      const key = `${chunk.tileKey}:${chunk.zoom}`;
      placeKeysByTile.set(
        key,
        (placeKeysByTile.get(key) ?? 0) + chunk.placeKeys.length
      );
    }
    const avgPlaceKeysPerTile =
      placeKeysByTile.size > 0
        ? Array.from(placeKeysByTile.values()).reduce((a, b) => a + b, 0) /
          placeKeysByTile.size
        : 0;

    return {
      totalChunks: allChunks.length,
      uniqueTiles,
      expiredChunks,
      avgPlaceKeysPerTile: Math.round(avgPlaceKeysPerTile * 10) / 10,
    };
  },
});

// ============================================================================
// Public API (for client-side use)
// ============================================================================

/**
 * Public query to check tile cache (for map components)
 */
export const checkTileCachePublic = query({
  args: {
    tileKey: v.string(),
    zoom: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ placeKeys: string[]; cacheHit: true } | { cacheHit: false }> => {
    const now = Date.now();

    const chunks = await ctx.db
      .query("mapTileCache")
      .withIndex("by_tile", (q) =>
        q.eq("tileKey", args.tileKey).eq("zoom", args.zoom)
      )
      .collect();

    if (chunks.length === 0) {
      return { cacheHit: false };
    }

    const hasExpired = chunks.some((chunk) => chunk.expiresAt <= now);
    if (hasExpired) {
      return { cacheHit: false };
    }

    const allPlaceKeys: string[] = [];
    for (const chunk of chunks.sort((a, b) => a.chunk - b.chunk)) {
      allPlaceKeys.push(...chunk.placeKeys);
    }

    return {
      placeKeys: allPlaceKeys,
      cacheHit: true,
    };
  },
});

/**
 * Public mutation to write tile cache (for map components after provider search)
 */
export const writeTileCachePublic = mutation({
  args: {
    tileKey: v.string(),
    zoom: v.number(),
    placeKeys: v.array(v.string()),
    provider: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    const expiresAt = now + MAP_TILE_CACHE_TTL_MS;

    // Delete existing chunks
    const existingChunks = await ctx.db
      .query("mapTileCache")
      .withIndex("by_tile", (q) =>
        q.eq("tileKey", args.tileKey).eq("zoom", args.zoom)
      )
      .collect();

    for (const chunk of existingChunks) {
      await ctx.db.delete(chunk._id);
    }

    // Split and insert chunks (ensure at least 1 chunk even if empty, to mark tile as checked)
    const totalPlaceKeys = args.placeKeys.slice(0, MAX_PLACE_KEYS_PER_CHUNK * MAX_CHUNKS_PER_TILE);
    const numChunks = Math.max(1, Math.ceil(totalPlaceKeys.length / MAX_PLACE_KEYS_PER_CHUNK));

    for (let i = 0; i < numChunks; i++) {
      const start = i * MAX_PLACE_KEYS_PER_CHUNK;
      const end = Math.min(start + MAX_PLACE_KEYS_PER_CHUNK, totalPlaceKeys.length);

      await ctx.db.insert("mapTileCache", {
        tileKey: args.tileKey,
        zoom: args.zoom,
        chunk: i,
        provider: args.provider,
        placeKeys: totalPlaceKeys.slice(start, end),
        expiresAt,
        createdAt: now,
      });
    }
  },
});

/**
 * Public query to get tiles for viewport
 *
 * Returns which tiles are cached and which need fetching
 */
export const getTilesForViewport = query({
  args: {
    bounds: v.object({
      north: v.number(),
      south: v.number(),
      east: v.number(),
      west: v.number(),
    }),
    zoom: v.number(),
  },
  handler: async (ctx, args): Promise<{
    tileKeys: string[];
    cached: Array<{ tileKey: string; placeKeys: string[] }>;
    uncached: string[];
  }> => {
    const now = Date.now();
    const tileKeys = getTileKeysForBounds(args.bounds, args.zoom);

    const cached: Array<{ tileKey: string; placeKeys: string[] }> = [];
    const uncached: string[] = [];

    for (const tileKey of tileKeys) {
      const chunks = await ctx.db
        .query("mapTileCache")
        .withIndex("by_tile", (q) =>
          q.eq("tileKey", tileKey).eq("zoom", args.zoom)
        )
        .collect();

      if (chunks.length === 0 || chunks.some((c) => c.expiresAt <= now)) {
        uncached.push(tileKey);
      } else {
        const placeKeys = chunks
          .sort((a, b) => a.chunk - b.chunk)
          .flatMap((c) => c.placeKeys);
        cached.push({ tileKey, placeKeys });
      }
    }

    return { tileKeys, cached, uncached };
  },
});
