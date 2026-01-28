"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { MapBounds } from "@/components/maps";
import { useMapTileCache } from "./useMapTileCache";

/**
 * Debounce delay before showing "Search this area" button (ms)
 */
const BOUNDS_DEBOUNCE_DELAY = 300;

/**
 * Cooldown between searches to prevent rapid re-searching (ms)
 */
const SEARCH_COOLDOWN = 2000;

export interface MapSearchResult {
  /** Place key (formatted as "g:{placeId}") */
  placeKey: string;
  /** Place ID (Google format) */
  placeId: string;
  /** Display name */
  displayName: string;
  /** Location coordinates */
  location: { lat: number; lng: number };
}

export interface UseMapSearchOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Minimum cooldown between searches in ms (default: 2000) */
  cooldownMs?: number;
  /** Default search query when none provided */
  defaultQuery?: string;
  /** Language code for results */
  language?: string;
  /** Map zoom level for tile caching */
  zoom?: number;
  /** Whether to use tile caching (default: true) */
  useTileCache?: boolean;
}

export interface UseMapSearchResult {
  /** Current map bounds (after debounce) */
  pendingBounds: MapBounds | null;
  /** Whether to show "Search this area" button */
  showSearchButton: boolean;
  /** Search results */
  results: MapSearchResult[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Cooldown remaining until next search allowed (ms) */
  cooldownRemaining: number;
  /** Whether search is on cooldown */
  isOnCooldown: boolean;
  /** Handle bounds change from map */
  handleBoundsChange: (bounds: MapBounds) => void;
  /** Trigger search for the pending bounds */
  searchArea: (query?: string) => Promise<void>;
  /** Clear search state */
  clear: () => void;
  /** Place keys from tile cache (if enabled) */
  cachedPlaceKeys: string[];
  /** Number of tile cache hits */
  tileCacheHits: number;
  /** Number of tile cache misses */
  tileCacheMisses: number;
}

/**
 * Hook for "Search this area" map functionality with debouncing and cooldown
 *
 * @example
 * ```tsx
 * const {
 *   showSearchButton,
 *   handleBoundsChange,
 *   searchArea,
 *   results,
 *   isLoading,
 *   isOnCooldown,
 * } = useMapSearch();
 *
 * return (
 *   <>
 *     <MapView places={results} onBoundsChange={handleBoundsChange} />
 *     {showSearchButton && (
 *       <SearchThisAreaButton
 *         onClick={() => searchArea()}
 *         isLoading={isLoading}
 *         disabled={isOnCooldown}
 *       />
 *     )}
 *   </>
 * );
 * ```
 */
export function useMapSearch(options: UseMapSearchOptions = {}): UseMapSearchResult {
  const {
    debounceMs = BOUNDS_DEBOUNCE_DELAY,
    cooldownMs = SEARCH_COOLDOWN,
    // TODO: Use defaultQuery and language when actual API call is implemented
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    defaultQuery = "restaurant",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    language = "en",
    zoom = 13,
    useTileCache = true,
  } = options;

  // Tile cache integration
  const tileCache = useMapTileCache({
    zoom,
    enabled: useTileCache,
  });

  // Work around TypeScript depth limitations with complex Convex types
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const apiRef: any = require("@/convex/_generated/api").api;

  // Mutation for writing tile cache
  const writeTileCacheMutation = useMutation(apiRef.mapTileCache.writeTileCachePublic);

  const [pendingBounds, setPendingBounds] = useState<MapBounds | null>(null);
  const [showSearchButton, setShowSearchButton] = useState(false);
  const [results, setResults] = useState<MapSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [lastSearchedBounds, setLastSearchedBounds] = useState<MapBounds | null>(null);

  // Refs for timers
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Abort controller for cancelling requests
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Check if bounds are different enough to warrant a new search
   */
  const boundsChanged = useCallback((newBounds: MapBounds, oldBounds: MapBounds | null): boolean => {
    if (!oldBounds) return true;

    // Calculate the change threshold (5% of bounds size)
    const latDiff = Math.abs(newBounds.north - newBounds.south);
    const lngDiff = Math.abs(newBounds.east - newBounds.west);
    const threshold = Math.min(latDiff, lngDiff) * 0.05;

    return (
      Math.abs(newBounds.north - oldBounds.north) > threshold ||
      Math.abs(newBounds.south - oldBounds.south) > threshold ||
      Math.abs(newBounds.east - oldBounds.east) > threshold ||
      Math.abs(newBounds.west - oldBounds.west) > threshold
    );
  }, []);

  /**
   * Handle bounds change from map (debounced)
   */
  const handleBoundsChange = useCallback(
    (bounds: MapBounds) => {
      // Clear previous debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Update tile cache with new viewport
      if (useTileCache) {
        tileCache.handleViewportChange(bounds);
      }

      // Check if bounds changed significantly from last search
      if (!boundsChanged(bounds, lastSearchedBounds)) {
        setShowSearchButton(false);
        return;
      }

      // Debounce before showing button
      debounceTimerRef.current = setTimeout(() => {
        setPendingBounds(bounds);
        // Show search button if bounds changed significantly
        // Note: We don't check tileCache.uncachedTiles here because the query
        // is async and may not have returned yet. The actual search logic
        // will handle cached vs uncached tiles efficiently.
        setShowSearchButton(true);
      }, debounceMs);
    },
    // Note: tileCache is included because tileCache.handleViewportChange is called
    // outside the setTimeout and needs the latest reference when zoom/enabled changes
    [debounceMs, lastSearchedBounds, boundsChanged, useTileCache, tileCache]
  );

  /**
   * Perform bounded search
   *
   * When tile caching is enabled:
   * 1. Uses cached placeKeys for already-fetched tiles
   * 2. Only fetches from provider for uncached tiles
   * 3. Writes new results to tile cache
   */
  const searchArea = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (query?: string) => {
      if (!pendingBounds) return;
      if (cooldownRemaining > 0) return;

      // Cancel any pending request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        setIsLoading(true);
        setError(null);
        setShowSearchButton(false);

        // Collect results: start with cached placeKeys
        const allPlaceKeys = new Set<string>();

        // Add cached placeKeys if tile caching is enabled
        if (useTileCache) {
          for (const key of tileCache.cachedPlaceKeys) {
            allPlaceKeys.add(key);
          }
        }

        // Fetch uncached tiles from provider
        if (!useTileCache || tileCache.uncachedTiles.length > 0) {
          const tilesToFetch = useTileCache
            ? tileCache.uncachedTiles
            : [{ tileKey: "viewport", bounds: pendingBounds }];

          for (const tile of tilesToFetch) {
            // Check if request was aborted
            if (abortControllerRef.current.signal.aborted) {
              return;
            }

            // TODO: Replace with actual Convex action call
            // This would call the ProviderGateway with TEXT_SEARCH field set
            // const result = await textSearch({
            //   fieldSet: "TEXT_SEARCH",
            //   endpointClass: "text_search",
            //   textQuery: query || defaultQuery,
            //   locationRestriction: {
            //     rectangle: {
            //       low: { latitude: tile.bounds.south, longitude: tile.bounds.west },
            //       high: { latitude: tile.bounds.north, longitude: tile.bounds.east },
            //     },
            //   },
            //   language,
            // });

            // Mock: In production, extract placeKeys from provider response
            const fetchedPlaceKeys: string[] = [];

            // Add fetched placeKeys to results
            for (const key of fetchedPlaceKeys) {
              allPlaceKeys.add(key);
            }

            // Write to tile cache (only for real tiles, not the viewport fallback)
            // Note: We cache even empty results to mark the tile as "checked, nothing here"
            // This prevents re-fetching tiles with no places (e.g., ocean, industrial zones)
            if (useTileCache && tile.tileKey !== "viewport") {
              await writeTileCacheMutation({
                tileKey: tile.tileKey,
                zoom,
                placeKeys: fetchedPlaceKeys,
                provider: "google",
              });
            }
          }
        }

        // Check if request was aborted
        if (abortControllerRef.current.signal.aborted) {
          return;
        }

        // Convert placeKeys to results (in production, would fetch details for visible ones)
        // For now, create stub results
        const newResults: MapSearchResult[] = Array.from(allPlaceKeys).map((placeKey) => ({
          placeKey,
          placeId: placeKey.replace(/^g:/, ""),
          displayName: "", // Would come from place details
          location: { lat: 0, lng: 0 }, // Would come from place details
        }));

        setResults(newResults);
        setLastSearchedBounds(pendingBounds);
        setPendingBounds(null);

        // Start cooldown
        setCooldownRemaining(cooldownMs);

        // Update cooldown every 100ms
        cooldownIntervalRef.current = setInterval(() => {
          setCooldownRemaining((prev) => {
            if (prev <= 100) {
              clearInterval(cooldownIntervalRef.current!);
              return 0;
            }
            return prev - 100;
          });
        }, 100);

        // Clear cooldown after duration
        cooldownTimerRef.current = setTimeout(() => {
          setCooldownRemaining(0);
          if (cooldownIntervalRef.current) {
            clearInterval(cooldownIntervalRef.current);
          }
        }, cooldownMs);
      } catch (err) {
        // Don't show error if request was aborted
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setIsLoading(false);
      }
    },
    [pendingBounds, cooldownRemaining, cooldownMs, useTileCache, tileCache, zoom, writeTileCacheMutation]
  );

  /**
   * Clear search state
   */
  const clear = useCallback(() => {
    setResults([]);
    setPendingBounds(null);
    setShowSearchButton(false);
    setError(null);
    setIsLoading(false);
    setLastSearchedBounds(null);

    // Cancel any pending request
    abortControllerRef.current?.abort();

    // Clear timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    pendingBounds,
    showSearchButton,
    results,
    isLoading,
    error,
    cooldownRemaining,
    isOnCooldown: cooldownRemaining > 0,
    handleBoundsChange,
    searchArea,
    clear,
    // Tile cache info
    cachedPlaceKeys: useTileCache ? tileCache.cachedPlaceKeys : [],
    tileCacheHits: useTileCache ? tileCache.cacheHits : 0,
    tileCacheMisses: useTileCache ? tileCache.cacheMisses : 0,
  };
}
