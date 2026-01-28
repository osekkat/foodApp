"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import type { MapBounds } from "@/components/maps";

/**
 * Geohash precision based on zoom level
 * Must match the Convex mapTileCache.ts values
 */
const ZOOM_TO_GEOHASH_PRECISION: Record<number, number> = {
  5: 3, 6: 3, 7: 3,
  8: 4, 9: 4, 10: 4,
  11: 5, 12: 5, 13: 5,
  14: 6, 15: 6, 16: 6,
  17: 7, 18: 7, 19: 7, 20: 7,
};

/**
 * Base32 alphabet for geohash encoding
 */
const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encode lat/lng to geohash string
 */
function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  let hash = "";
  let isLng = true;
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
 * Get geohash precision for a zoom level
 */
function getGeohashPrecision(zoom: number): number {
  const clampedZoom = Math.max(5, Math.min(20, Math.round(zoom)));
  return ZOOM_TO_GEOHASH_PRECISION[clampedZoom] ?? 5;
}

/**
 * Decode geohash to bounding box
 */
function decodeGeohashBounds(geohash: string): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  let isLng = true;

  for (const char of geohash.toLowerCase()) {
    const charIndex = GEOHASH_ALPHABET.indexOf(char);
    if (charIndex === -1) continue;

    for (let bits = 4; bits >= 0; bits--) {
      const bit = (charIndex >> bits) & 1;
      if (isLng) {
        const mid = (lngMin + lngMax) / 2;
        if (bit === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) latMin = mid;
        else latMax = mid;
      }
      isLng = !isLng;
    }
  }

  return { north: latMax, south: latMin, east: lngMax, west: lngMin };
}

/**
 * Get neighboring geohashes
 */
function getGeohashNeighbors(geohash: string): string[] {
  const bounds = decodeGeohashBounds(geohash);
  const precision = geohash.length;
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const latOffset = (bounds.north - bounds.south) * 0.9;
  const lngOffset = (bounds.east - bounds.west) * 0.9;

  const neighbors: string[] = [geohash];
  const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  for (const [latMult, lngMult] of offsets) {
    const newLat = centerLat + latOffset * latMult;
    const newLng = centerLng + lngOffset * lngMult;
    if (newLat >= -90 && newLat <= 90 && newLng >= -180 && newLng <= 180) {
      neighbors.push(encodeGeohash(newLat, newLng, precision));
    }
  }

  return [...new Set(neighbors)];
}

/**
 * Generate tile key from coordinates and zoom
 */
function generateTileKey(lat: number, lng: number, zoom: number): string {
  const precision = getGeohashPrecision(zoom);
  const geohash = encodeGeohash(lat, lng, precision);
  return `gh:${precision}:${geohash}`;
}

/**
 * Get all tile keys that cover a bounding box
 */
function getTileKeysForBounds(bounds: MapBounds, zoom: number): string[] {
  const precision = getGeohashPrecision(zoom);
  const points = [
    { lat: bounds.north, lng: bounds.west },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
    { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 },
  ];

  const tileKeys = new Set<string>();

  for (const point of points) {
    const geohash = encodeGeohash(point.lat, point.lng, precision);
    tileKeys.add(`gh:${precision}:${geohash}`);
    for (const neighbor of getGeohashNeighbors(geohash)) {
      tileKeys.add(`gh:${precision}:${neighbor}`);
    }
  }

  return Array.from(tileKeys);
}

export interface UseMapTileCacheOptions {
  /** Current zoom level */
  zoom: number;
  /** Whether to enable tile caching */
  enabled?: boolean;
}

export interface UseMapTileCacheResult {
  /** Place keys from cached tiles */
  cachedPlaceKeys: string[];
  /** Tiles that need to be fetched from provider */
  uncachedTiles: Array<{ tileKey: string; bounds: MapBounds }>;
  /** Whether any tiles are being fetched */
  isLoading: boolean;
  /** Handle viewport change - returns cached/uncached tile info */
  handleViewportChange: (bounds: MapBounds) => void;
  /** Write place keys to cache for a tile after fetching */
  writeTileToCache: (tileKey: string, placeKeys: string[]) => Promise<void>;
  /** Current viewport bounds being tracked */
  currentBounds: MapBounds | null;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
}

/**
 * Hook for map tile caching
 *
 * Manages ID-only tile cache to reduce provider API calls during map pan/zoom.
 * Tiles are geohash-based cells that store placeKeys for efficient spatial queries.
 *
 * @example
 * ```tsx
 * const {
 *   cachedPlaceKeys,
 *   uncachedTiles,
 *   handleViewportChange,
 *   writeTileToCache,
 * } = useMapTileCache({ zoom: 13 });
 *
 * // When map bounds change
 * const onBoundsChange = (bounds) => {
 *   handleViewportChange(bounds);
 *
 *   // For uncached tiles, fetch from provider and cache
 *   for (const tile of uncachedTiles) {
 *     const placeKeys = await fetchPlacesInBounds(tile.bounds);
 *     await writeTileToCache(tile.tileKey, placeKeys);
 *   }
 * };
 * ```
 */
export function useMapTileCache(options: UseMapTileCacheOptions): UseMapTileCacheResult {
  const { zoom, enabled = true } = options;

  const [currentBounds, setCurrentBounds] = useState<MapBounds | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheHits, setCacheHits] = useState(0);
  const [cacheMisses, setCacheMisses] = useState(0);

  // Track seen tiles to avoid redundant queries
  const seenTilesRef = useRef<Set<string>>(new Set());

  // Work around TypeScript depth limitations with complex Convex types
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const apiRef: any = require("@/convex/_generated/api").api;

  // Convex mutation for writing to cache
  const writeTileCacheMutation = useMutation(apiRef.mapTileCache.writeTileCachePublic);

  // Query for current viewport tiles
  const viewportTiles = useQuery(
    apiRef.mapTileCache.getTilesForViewport,
    enabled && currentBounds ? { bounds: currentBounds, zoom } : "skip"
  ) as {
    tileKeys: string[];
    cached: Array<{ tileKey: string; placeKeys: string[] }>;
    uncached: string[];
  } | undefined;

  // Memoize cached placeKeys (deduplicated)
  const cachedPlaceKeys = useMemo(() => {
    if (!viewportTiles?.cached) return [];
    const allKeys = new Set<string>();
    for (const tile of viewportTiles.cached) {
      for (const key of tile.placeKeys) {
        allKeys.add(key);
      }
    }
    return Array.from(allKeys);
  }, [viewportTiles?.cached]);

  // Memoize uncached tiles with their bounds
  const uncachedTiles = useMemo(() => {
    if (!viewportTiles?.uncached) return [];

    return viewportTiles.uncached
      .map((tileKey: string) => {
        // Parse tile key to get bounds
        const match = tileKey.match(/^gh:\d+:([0-9bcdefghjkmnpqrstuvwxyz]+)$/);
        if (!match) return null;

        const geohash = match[1];
        const bounds = decodeGeohashBounds(geohash);

        return { tileKey, bounds };
      })
      .filter(
        (t: { tileKey: string; bounds: MapBounds } | null): t is { tileKey: string; bounds: MapBounds } => t !== null
      );
  }, [viewportTiles?.uncached]);

  // Handle viewport change
  const handleViewportChange = useCallback((bounds: MapBounds) => {
    if (!enabled) return;

    setCurrentBounds(bounds);

    // Track seen tiles for deduplication
    const tileKeys = getTileKeysForBounds(bounds, zoom);
    for (const key of tileKeys) {
      seenTilesRef.current.add(key);
    }
  }, [enabled, zoom]);

  // Track previous viewportTiles to detect new results
  const prevViewportTilesRef = useRef<typeof viewportTiles>(undefined);

  // Update stats when viewportTiles changes
  useEffect(() => {
    if (!viewportTiles || viewportTiles === prevViewportTilesRef.current) return;
    prevViewportTilesRef.current = viewportTiles;

    setCacheHits((prev) => prev + viewportTiles.cached.length);
    setCacheMisses((prev) => prev + viewportTiles.uncached.length);
  }, [viewportTiles]);

  // Write tile to cache
  const writeTileToCache = useCallback(async (tileKey: string, placeKeys: string[]) => {
    if (!enabled) return;

    setIsLoading(true);
    try {
      await writeTileCacheMutation({
        tileKey,
        zoom,
        placeKeys,
        provider: "google",
      });
    } finally {
      setIsLoading(false);
    }
  }, [enabled, zoom, writeTileCacheMutation]);

  return {
    cachedPlaceKeys,
    uncachedTiles,
    isLoading,
    handleViewportChange,
    writeTileToCache,
    currentBounds,
    cacheHits,
    cacheMisses,
  };
}

/**
 * Parse tile key to extract geohash bounds
 * Useful for determining search area when fetching tile data
 */
export function parseTileKeyToBounds(tileKey: string): MapBounds | null {
  const match = tileKey.match(/^gh:\d+:([0-9bcdefghjkmnpqrstuvwxyz]+)$/);
  if (!match) return null;
  return decodeGeohashBounds(match[1]);
}

/**
 * Export utility functions for use in other components
 */
export { generateTileKey, getTileKeysForBounds, encodeGeohash, decodeGeohashBounds };
