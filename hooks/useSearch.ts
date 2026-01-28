"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  SearchSessionManager,
  type AutocompleteResult,
} from "@/lib/searchSession";

/**
 * Debounce delay for autocomplete requests (ms)
 */
const DEBOUNCE_DELAY = 300;

/**
 * Minimum query length before making autocomplete request
 */
const MIN_QUERY_LENGTH = 2;

export interface UseSearchOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Minimum query length (default: 2) */
  minQueryLength?: number;
  /** Location bias for autocomplete */
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
  /** Included place types for filtering */
  includedPrimaryTypes?: string[];
  /** Language code (default: "en") */
  language?: string;
}

export interface UseSearchResult {
  /** Current search query */
  query: string;
  /** Set the search query */
  setQuery: (query: string) => void;
  /** Autocomplete suggestions */
  suggestions: AutocompleteResult[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether we're in a degraded state (e.g., load shedding) */
  isDegraded: boolean;
  /** Select a place from suggestions (completes session) */
  selectPlace: (placeId: string) => Promise<void>;
  /** Clear search and reset state */
  clear: () => void;
  /** Whether autocomplete is enabled based on query length */
  isAutocompleteEnabled: boolean;
}

interface AutocompleteResponse {
  suggestions: Array<{
    placePrediction: {
      placeId: string;
      text: { text: string; matches?: { startOffset: number; endOffset: number }[] };
      structuredFormat: { mainText: { text: string }; secondaryText?: { text: string } };
      types: string[];
    };
  }>;
}

/**
 * Hook for search with autocomplete, debouncing, and session management
 *
 * @example
 * ```tsx
 * const { query, setQuery, suggestions, isLoading, selectPlace, clear } = useSearch({
 *   locationBias: { lat: 31.6295, lng: -7.9811, radiusMeters: 50000 },
 * });
 *
 * return (
 *   <input
 *     value={query}
 *     onChange={(e) => setQuery(e.target.value)}
 *     placeholder="Search for restaurants..."
 *   />
 *   {isLoading && <Spinner />}
 *   {suggestions.map((s) => (
 *     <button key={s.placeId} onClick={() => selectPlace(s.placeId)}>
 *       {s.structuredFormat?.mainText.text}
 *     </button>
 *   ))}
 * );
 * ```
 */
export function useSearch(options: UseSearchOptions = {}): UseSearchResult {
  const {
    debounceMs = DEBOUNCE_DELAY,
    minQueryLength = MIN_QUERY_LENGTH,
    locationBias,
    includedPrimaryTypes,
    language = "en",
  } = options;

  const [query, setQueryState] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDegraded, setIsDegraded] = useState(false);

  // Convex action for autocomplete
  const autocomplete = useAction(api.places.autocomplete);

  // Session manager for token lifecycle
  const sessionManagerRef = useRef<SearchSessionManager | null>(null);

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Request counter to handle race conditions with isLoading
  const requestCounterRef = useRef(0);

  // Initialize session manager
  useEffect(() => {
    sessionManagerRef.current = new SearchSessionManager();
    return () => {
      sessionManagerRef.current?.clearSession();
    };
  }, []);

  /**
   * Perform autocomplete request
   */
  const performAutocomplete = useCallback(
    async (searchQuery: string) => {
      if (!sessionManagerRef.current) return;

      const sessionManager = sessionManagerRef.current;

      // Increment counter and capture this request's ID
      requestCounterRef.current += 1;
      const thisRequestId = requestCounterRef.current;

      try {
        setIsLoading(true);
        setError(null);

        // Get abort signal to cancel any previous request
        const signal = sessionManager.getAbortSignal();

        // Perform the autocomplete request via Convex action
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await autocomplete({
          input: searchQuery,
          sessionToken: sessionManager.getToken(),
          language,
          locationBias,
          includedPrimaryTypes,
        });

        // Check if this request was superseded by a newer one
        if (signal.aborted || thisRequestId !== requestCounterRef.current) {
          return;
        }

        if (result.success && result.data) {
          const data = result.data as AutocompleteResponse;
          setSuggestions(
            data.suggestions.map((s) => ({
              placeId: s.placePrediction.placeId,
              text: s.placePrediction.text,
              structuredFormat: s.placePrediction.structuredFormat,
              types: s.placePrediction.types,
            }))
          );
          // Clear degraded state on success
          setIsDegraded(false);
        } else {
          // Only update error if this is still the current request
          if (thisRequestId === requestCounterRef.current) {
            const errorCode = result.error?.code;

            // Handle load shedding gracefully
            if (errorCode === "LOAD_SHED") {
              setIsDegraded(true);
              setError("Search temporarily limited due to high demand. Please try again.");
              // Keep existing suggestions if any (graceful degradation)
              // setSuggestions([]); - Don't clear existing suggestions
            } else {
              setError(result.error?.message || "Search failed");
              setSuggestions([]);
            }
          }
        }
      } catch (err) {
        // Don't show error if request was aborted (user typed more)
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        // Only update error if this is still the current request
        if (thisRequestId === requestCounterRef.current) {
          setError(err instanceof Error ? err.message : "Search failed");
          setSuggestions([]);
        }
      } finally {
        // Only set loading false if this is still the current request
        if (thisRequestId === requestCounterRef.current) {
          setIsLoading(false);
        }
      }
    },
    [autocomplete, language, locationBias, includedPrimaryTypes]
  );

  /**
   * Set query with debouncing
   */
  const setQuery = useCallback(
    (newQuery: string) => {
      setQueryState(newQuery);

      // Clear previous debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Clear suggestions if query is too short
      if (newQuery.length < minQueryLength) {
        setSuggestions([]);
        setError(null);
        return;
      }

      // Debounce the autocomplete request
      debounceTimerRef.current = setTimeout(() => {
        performAutocomplete(newQuery);
      }, debounceMs);
    },
    [debounceMs, minQueryLength, performAutocomplete]
  );

  /**
   * Select a place from suggestions
   * This completes the session and triggers place details fetch
   */
  const selectPlace = useCallback(async (placeId: string) => {
    if (!sessionManagerRef.current) return;

    // Complete the session (this consumes the token for billing)
    sessionManagerRef.current.completeSession();

    // Clear suggestions
    setSuggestions([]);

    // TODO: Navigate to place details page or fetch details
    // This would typically be handled by the parent component
    console.log("Selected place:", placeId);
  }, []);

  /**
   * Clear search state
   */
  const clear = useCallback(() => {
    setQueryState("");
    setSuggestions([]);
    setError(null);
    setIsLoading(false);
    setIsDegraded(false);

    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Clear session without completing (no billing charge for unused session)
    sessionManagerRef.current?.clearSession();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    isLoading,
    error,
    isDegraded,
    selectPlace,
    clear,
    isAutocompleteEnabled: query.length >= minQueryLength,
  };
}