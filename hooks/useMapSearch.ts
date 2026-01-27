"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapBounds } from "@/components/maps";

/**
 * Debounce delay before showing "Search this area" button (ms)
 */
const BOUNDS_DEBOUNCE_DELAY = 300;

/**
 * Cooldown between searches to prevent rapid re-searching (ms)
 */
const SEARCH_COOLDOWN = 2000;

export interface MapSearchResult {
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
  } = options;

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

      // Check if bounds changed significantly from last search
      if (!boundsChanged(bounds, lastSearchedBounds)) {
        setShowSearchButton(false);
        return;
      }

      // Debounce before showing button
      debounceTimerRef.current = setTimeout(() => {
        setPendingBounds(bounds);
        setShowSearchButton(true);
      }, debounceMs);
    },
    [debounceMs, lastSearchedBounds, boundsChanged]
  );

  /**
   * Perform bounded search
   */
  const searchArea = useCallback(
    async (query?: string) => {
      if (!pendingBounds) return;
      if (cooldownRemaining > 0) return;

      // Cancel any pending request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      const searchQuery = query || defaultQuery;

      try {
        setIsLoading(true);
        setError(null);
        setShowSearchButton(false);

        // TODO: Replace with actual Convex action call when public action is created
        // This would call the ProviderGateway with TEXT_SEARCH field set
        // const result = await textSearch({
        //   fieldSet: "TEXT_SEARCH",
        //   endpointClass: "text_search",
        //   textQuery: searchQuery,
        //   locationRestriction: {
        //     rectangle: {
        //       low: { latitude: pendingBounds.south, longitude: pendingBounds.west },
        //       high: { latitude: pendingBounds.north, longitude: pendingBounds.east },
        //     },
        //   },
        //   language,
        // });

        // Check if request was aborted
        if (abortControllerRef.current.signal.aborted) {
          return;
        }

        // Mock empty response - replace with actual API call
        // In production, this would transform the provider response
        setResults([]);
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
    [pendingBounds, cooldownRemaining, cooldownMs, defaultQuery, language]
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
  };
}
