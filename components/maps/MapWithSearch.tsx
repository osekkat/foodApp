"use client";

import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { normalizeMapSearchQuery } from "@/lib/mapSearchFlow";
import { useMapSearch } from "@/hooks/useMapSearch";
import { MapView, type PlaceMarkerData } from "./";
import { SearchThisAreaButton } from "@/components/search";

export interface MapWithSearchProps {
  /** Initial center point */
  center?: { lat: number; lng: number };
  /** Initial zoom level */
  zoom?: number;
  /** Callback when a place marker is clicked */
  onPlaceClick?: (placeKey: string) => void;
  /** Additional places to show (e.g., from favorites, curated) */
  additionalPlaces?: PlaceMarkerData[];
  /** Search query for area search (default: "restaurant") */
  searchQuery?: string;
  /** Whether to show clustering */
  enableClustering?: boolean;
  /** Custom CSS class for container */
  className?: string;
}

/**
 * Map with integrated "Search this area" functionality.
 *
 * This component combines:
 * - MapView for Google Maps display
 * - useMapSearch hook for debounced bounds handling
 * - SearchThisAreaButton for user-triggered search
 *
 * @example
 * ```tsx
 * <MapWithSearch
 *   center={{ lat: 33.5731, lng: -7.5898 }}
 *   zoom={13}
 *   onPlaceClick={(placeKey) => router.push(`/place/${placeKey}`)}
 *   searchQuery="restaurants"
 * />
 * ```
 */
export function MapWithSearch({
  center,
  zoom,
  onPlaceClick,
  additionalPlaces = [],
  searchQuery = "restaurant",
  enableClustering = true,
  className,
}: MapWithSearchProps) {
  const {
    showSearchButton,
    results,
    isLoading,
    cooldownRemaining,
    isOnCooldown,
    handleBoundsChange,
    searchArea,
  } = useMapSearch({
    defaultQuery: normalizeMapSearchQuery(searchQuery, "restaurant"),
  });

  // Convert search results to PlaceMarkerData format
  const searchPlaces = useMemo<PlaceMarkerData[]>(() => {
    return results.map((result) => ({
      placeKey: `g:${result.placeId}`,
      name: result.displayName,
      location: result.location,
      placeType: "restaurant" as const, // Default type, could be enhanced
    }));
  }, [results]);

  // Combine additional places with search results
  const allPlaces = useMemo<PlaceMarkerData[]>(() => {
    // Use a Map to deduplicate by placeKey
    const placeMap = new Map<string, PlaceMarkerData>();

    // Add additional places first (they take priority)
    for (const place of additionalPlaces) {
      placeMap.set(place.placeKey, place);
    }

    // Add search results
    for (const place of searchPlaces) {
      if (!placeMap.has(place.placeKey)) {
        placeMap.set(place.placeKey, place);
      }
    }

    return Array.from(placeMap.values());
  }, [additionalPlaces, searchPlaces]);

  // Handle search button click
  const handleSearchClick = useCallback(() => {
    const normalizedQuery = searchQuery.trim();
    searchArea(normalizedQuery || undefined);
  }, [searchArea, searchQuery]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <MapView
        places={allPlaces}
        center={center}
        zoom={zoom}
        onBoundsChange={handleBoundsChange}
        onPlaceClick={onPlaceClick}
        enableClustering={enableClustering}
      />

      {/* Search this area button - positioned at top center */}
      {showSearchButton && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2">
          <SearchThisAreaButton
            onClick={handleSearchClick}
            isLoading={isLoading}
            disabled={isOnCooldown}
            cooldownRemaining={cooldownRemaining}
          />
        </div>
      )}
    </div>
  );
}
