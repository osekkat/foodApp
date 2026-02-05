"use client";

import { useCallback, useRef, useEffect } from "react";
import { Search, Filter, SlidersHorizontal, MapIcon, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  PlaceListCard,
  PlaceListCardSkeleton,
  type PlaceListItemData,
} from "./PlaceListCard";

export interface PlaceListSidebarProps {
  /** List of places to display */
  places: PlaceListItemData[];
  /** Whether data is loading */
  isLoading?: boolean;
  /** Currently selected place key */
  selectedPlaceKey?: string | null;
  /** Currently hovered place key (from map hover) */
  hoveredPlaceKey?: string | null;
  /** Callback when a place is clicked */
  onPlaceClick?: (placeKey: string) => void;
  /** Callback when hovering over a place */
  onPlaceHover?: (placeKey: string | null) => void;
  /** Search query value */
  searchQuery?: string;
  /** Callback when search query changes */
  onSearchChange?: (query: string) => void;
  /** Callback when search is submitted */
  onSearchSubmit?: () => void;
  /** Header title */
  title?: string;
  /** Header subtitle */
  subtitle?: string;
  /** Sort options */
  sortBy?: "recommended" | "rating" | "distance" | "reviews";
  /** Callback when sort changes */
  onSortChange?: (sort: "recommended" | "rating" | "distance" | "reviews") => void;
  /** Custom class name */
  className?: string;
  /** Whether to show the header */
  showHeader?: boolean;
  /** Whether to show filters */
  showFilters?: boolean;
}

/**
 * PlaceListSidebar displays a scrollable list of places (like Yelp sidebar)
 *
 * Features:
 * - Scrollable list with hover sync to map
 * - Search input at top
 * - Filter/sort controls
 * - Results count
 * - Loading skeleton state
 * - Auto-scroll to selected place
 */
export function PlaceListSidebar({
  places,
  isLoading = false,
  selectedPlaceKey,
  hoveredPlaceKey,
  onPlaceClick,
  onPlaceHover,
  searchQuery = "",
  onSearchChange,
  onSearchSubmit,
  title = "Results",
  subtitle,
  sortBy = "recommended",
  onSortChange,
  className,
  showHeader = true,
  showFilters = true,
}: PlaceListSidebarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Auto-scroll to selected place when it changes (from map click)
  useEffect(() => {
    if (selectedPlaceKey && cardRefs.current.has(selectedPlaceKey)) {
      const cardEl = cardRefs.current.get(selectedPlaceKey);
      cardEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedPlaceKey]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        onSearchSubmit?.();
      }
    },
    [onSearchSubmit]
  );

  const handleMouseEnter = useCallback(
    (placeKey: string) => {
      onPlaceHover?.(placeKey);
    },
    [onPlaceHover]
  );

  const handleMouseLeave = useCallback(() => {
    onPlaceHover?.(null);
  }, [onPlaceHover]);

  const setCardRef = useCallback(
    (placeKey: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(placeKey, el);
      } else {
        cardRefs.current.delete(placeKey);
      }
    },
    []
  );

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-zinc-50 dark:bg-zinc-950",
        className
      )}
    >
      {/* Header with search */}
      {showHeader && (
        <div className="flex-shrink-0 border-b border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Title */}
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              type="text"
              placeholder="Search restaurants, cafes..."
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-10 pl-9 pr-4"
            />
          </div>

          {/* Filters and sort */}
          {showFilters && (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Filters
              </Button>
              <div className="flex-1" />
              <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <select
                  value={sortBy}
                  onChange={(e) =>
                    onSortChange?.(
                      e.target.value as
                        | "recommended"
                        | "rating"
                        | "distance"
                        | "reviews"
                    )
                  }
                  className="border-0 bg-transparent p-0 text-sm font-medium text-zinc-700 focus:outline-none focus:ring-0 dark:text-zinc-300"
                >
                  <option value="recommended">Recommended</option>
                  <option value="rating">Highest Rated</option>
                  <option value="distance">Nearest</option>
                  <option value="reviews">Most Reviewed</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results count */}
      <div className="flex-shrink-0 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {places.length}
              </span>{" "}
              {places.length === 1 ? "result" : "results"}
            </>
          )}
        </div>
      </div>

      {/* Scrollable list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="space-y-3 p-4">
          {isLoading ? (
            // Loading skeletons
            <>
              {[1, 2, 3, 4, 5].map((i) => (
                <PlaceListCardSkeleton key={i} />
              ))}
            </>
          ) : places.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MapIcon className="mb-3 h-12 w-12 text-zinc-300 dark:text-zinc-600" />
              <h3 className="font-medium text-zinc-700 dark:text-zinc-300">
                No places found
              </h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Try searching in a different area or adjusting your filters.
              </p>
            </div>
          ) : (
            // Place list
            places.map((place) => (
              <div key={place.placeKey} ref={setCardRef(place.placeKey)}>
                <PlaceListCard
                  place={place}
                  isSelected={selectedPlaceKey === place.placeKey}
                  isHovered={hoveredPlaceKey === place.placeKey}
                  onClick={onPlaceClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              </div>
            ))
          )}
        </div>

        {/* Sponsored/ad section placeholder (like Yelp) */}
        {!isLoading && places.length > 0 && (
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Sponsored Results
            </p>
            <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-100 p-6 text-center dark:border-zinc-700 dark:bg-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Featured placements coming soon
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact header for mobile view toggle
 */
export function MapListToggle({
  view,
  onViewChange,
  className,
}: {
  view: "map" | "list";
  onViewChange: (view: "map" | "list") => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-800",
        className
      )}
    >
      <Button
        variant={view === "list" ? "default" : "ghost"}
        size="sm"
        className="h-8 gap-1.5 rounded-md"
        onClick={() => onViewChange("list")}
      >
        <List className="h-4 w-4" />
        List
      </Button>
      <Button
        variant={view === "map" ? "default" : "ghost"}
        size="sm"
        className="h-8 gap-1.5 rounded-md"
        onClick={() => onViewChange("map")}
      >
        <MapIcon className="h-4 w-4" />
        Map
      </Button>
    </div>
  );
}
