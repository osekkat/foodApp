"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { MapBounds } from "@/components/maps";
import { useMapTileCache } from "./useMapTileCache";
import { normalizeMapSearchQuery } from "@/lib/mapSearchFlow";

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
  /** Primary type (e.g., "restaurant", "cafe") */
  primaryType?: string;
  /** Provider rating */
  rating?: number;
  /** Provider review count */
  userRatingCount?: number;
  /** Price level */
  priceLevel?: string;
  /** Formatted address */
  formattedAddress?: string;
  /** Photo URL (signed) for building photo proxy URL (policy-safe: reference only) */
  photoUrl?: string;
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
  /** Whether we currently have any bounds available to run a search */
  hasSearchBounds: boolean;
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
  /** Trigger search for pending bounds, or last searched bounds if pending is empty */
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
    defaultQuery = "restaurant",
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

  // Action for text search (using apiRef to avoid TypeScript depth issues)
  const textSearchAction = useAction(apiRef.places.textSearch);

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
   * Fetches places from provider for the current viewport bounds.
   * If tile caching is enabled, writes results to cache for future use.
   */
  const searchArea = useCallback(
    async (query?: string) => {
      const boundsToSearch = pendingBounds ?? lastSearchedBounds;
      if (!boundsToSearch) return;
      if (cooldownRemaining > 0) return;

      // Cancel any pending request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setIsLoading(true);
        setError(null);
        setShowSearchButton(false);

        // Call the real textSearch action
        const searchQuery = normalizeMapSearchQuery(query, defaultQuery);
        const result = await textSearchAction({
          query: searchQuery,
          locationRestriction: {
            north: boundsToSearch.north,
            south: boundsToSearch.south,
            east: boundsToSearch.east,
            west: boundsToSearch.west,
          },
          language,
        });

        // Check if request was aborted
        if (
          controller.signal.aborted ||
          abortControllerRef.current !== controller
        ) {
          return;
        }

        if (!result.success) {
          setError(result.error ?? "Search failed");
          setIsLoading(false);
          return;
        }

        // Transform results from provider
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const searchResultPlaces: MapSearchResult[] = result.places.map((place: any) => ({
          placeKey: place.placeKey,
          placeId: place.placeId,
          displayName: place.displayName,
          location: place.location,
          primaryType: place.primaryType,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
          priceLevel: place.priceLevel,
          formattedAddress: place.formattedAddress,
          photoUrl: place.photoUrl,
        }));

        // Write to tile cache for future use (if tile caching is enabled)
        if (useTileCache && result.places.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const placeKeys = result.places.map((p: any) => p.placeKey as string);
          try {
            await writeTileCacheMutation({
              tileKey: `viewport:${boundsToSearch.north.toFixed(4)},${boundsToSearch.south.toFixed(4)},${boundsToSearch.east.toFixed(4)},${boundsToSearch.west.toFixed(4)}`,
              zoom,
              placeKeys,
              provider: "google",
            });
          } catch {
            // Ignore tile cache write errors - they're not critical
          }
        }

        setResults(searchResultPlaces);
        setLastSearchedBounds(boundsToSearch);
        setPendingBounds(null);

        // Reset any previous cooldown timers before starting a new one
        if (cooldownTimerRef.current) {
          clearTimeout(cooldownTimerRef.current);
        }
        if (cooldownIntervalRef.current) {
          clearInterval(cooldownIntervalRef.current);
        }

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
        // Ignore errors from aborted/stale requests
        if (
          controller.signal.aborted ||
          abortControllerRef.current !== controller ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        // Only the latest in-flight request controls loading state
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [pendingBounds, lastSearchedBounds, cooldownRemaining, cooldownMs, useTileCache, zoom, writeTileCacheMutation, defaultQuery, language, textSearchAction]
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
    hasSearchBounds: pendingBounds !== null || lastSearchedBounds !== null,
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
