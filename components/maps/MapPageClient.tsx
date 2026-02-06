"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { useMapSearch } from "@/hooks/useMapSearch";
import { MapView, type PlaceMarkerData } from "./";
import { PlaceListSidebar, MapListToggle } from "./PlaceListSidebar";
import type { PlaceListItemData } from "./PlaceListCard";
import { SearchThisAreaButton } from "@/components/search";
import { Button } from "@/components/ui/button";
import { Expand, Shrink, RotateCcw, Search, MapPin } from "lucide-react";
import Link from "next/link";

/**
 * Default center on Casablanca, Morocco
 */
const DEFAULT_CENTER = {
  lat: 33.5731,
  lng: -7.5898,
};

const DEFAULT_ZOOM = 13;

/**
 * Convert Google place type to our type
 */
function _getPlaceType(
  primaryType?: string
): "restaurant" | "cafe" | "bakery" | "market" | "default" {
  if (!primaryType) return "default";
  const type = primaryType.toLowerCase();
  if (type.includes("restaurant") || type.includes("food")) return "restaurant";
  if (type.includes("cafe") || type.includes("coffee")) return "cafe";
  if (type.includes("bakery") || type.includes("pastry")) return "bakery";
  if (type.includes("market") || type.includes("grocery")) return "market";
  return "default";
}

/**
 * Convert price level enum to display string
 */
function _formatPriceLevel(priceLevel?: string): string | undefined {
  if (!priceLevel) return undefined;
  const levels: Record<string, string> = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return levels[priceLevel] || priceLevel;
}

export interface MapPageClientProps {
  /** Initial city slug for search */
  initialCity?: string;
  /** Initial search query */
  initialQuery?: string;
  /** Initial map center */
  initialCenter?: { lat: number; lng: number };
  /** Initial zoom level */
  initialZoom?: number;
}

/**
 * MapPageClient is the main component for the /map route.
 *
 * Layout (Yelp-style):
 * - Left sidebar (w-[400px]): scrollable list of places
 * - Right: full-height Google Map
 *
 * Features:
 * - Synced hover states between sidebar and map
 * - Click on map marker scrolls to card in sidebar
 * - Click on card highlights marker on map
 * - "Search this area" functionality
 * - Responsive: on mobile, toggle between map/list views
 */
export function MapPageClient({
  initialCity = "casablanca",
  initialQuery = "restaurants",
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
}: MapPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("q") || initialQuery
  );
  const [mobileView, setMobileView] = useState<"map" | "list">("list");
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [mapZoom, setMapZoom] = useState(initialZoom);

  // Map search hook
  const {
    showSearchButton,
    results: searchResults,
    isLoading: isSearching,
    handleBoundsChange,
    searchArea,
    isOnCooldown,
    cooldownRemaining,
  } = useMapSearch({
    defaultQuery: searchQuery,
    zoom: mapZoom,
  });

  // Work around TypeScript depth limitations with complex Convex types
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const apiRef: any = require("@/convex/_generated/api").api;

  // Fetch curated places for the city (always shown)
  const curatedPlaces = useQuery(apiRef.curatedPlaces.getFeaturedPlaces, {
    city: initialCity,
    limit: 20,
  });

  // Convert search results to sidebar format with indices
  const sidebarPlaces = useMemo<PlaceListItemData[]>(() => {
    const places: PlaceListItemData[] = [];

    // Add curated places first (they're featured)
    if (curatedPlaces) {
      for (const cp of curatedPlaces) {
        places.push({
          placeKey: cp.placeKey,
          name: cp.title,
          location: cp.location || {
            lat: 0,
            lng: 0,
          },
          placeType: "restaurant",
          neighborhood: cp.neighborhood || undefined,
          description: cp.summary,
          tags: cp.tags || undefined,
          isCurated: true,
          priceLevel: cp.priceNote || undefined,
        });
      }
    }

    // Add search results
    for (const result of searchResults) {
      // Skip results with no display name (unusable)
      if (!result.displayName) continue;

      // Skip if already added from curated
      if (places.some((p) => p.placeKey === result.placeKey)) continue;

      // Convert primary type to our format
      const placeType = result.primaryType
        ? _getPlaceType(result.primaryType)
        : "restaurant";

      // Convert price level to display format
      const priceLevel = result.priceLevel
        ? _formatPriceLevel(result.priceLevel)
        : undefined;

      places.push({
        placeKey: result.placeKey,
        name: result.displayName,
        location: result.location,
        placeType,
        providerRating: result.rating,
        providerReviewCount: result.userRatingCount,
        priceLevel,
        address: result.formattedAddress,
        photoUrl: result.photoUrl,
      });
    }

    // Add 1-based index to map-visible places (those with valid location).
    // Places without coordinates won't show a marker, so we leave them unnumbered
    // to avoid gaps/confusion between sidebar numbering and map markers.
    let counter = 0;
    return places.map((place) => {
      const hasLocation = place.location.lat !== 0 && place.location.lng !== 0;
      return {
        ...place,
        index: hasLocation ? ++counter : undefined,
      };
    });
  }, [curatedPlaces, searchResults]);

  // Convert to map marker format (indices already set in sidebarPlaces)
  const mapPlaces = useMemo<PlaceMarkerData[]>(() => {
    return sidebarPlaces
      .filter((p) => p.location.lat !== 0 && p.location.lng !== 0)
      .map((p) => ({
        placeKey: p.placeKey,
        name: p.name,
        location: p.location,
        placeType: p.placeType,
        rating: p.providerRating,
        isCurated: p.isCurated,
        index: p.index, // Already set with 1-based index matching sidebar order
      }));
  }, [sidebarPlaces]);

  // Handlers
  const handlePlaceClick = useCallback(
    (placeKey: string) => {
      setSelectedPlaceKey(placeKey);
      // Navigate to place detail
      const prefix = placeKey.startsWith("c:") ? "c" : "g";
      const id = placeKey.slice(2);
      router.push(`/place/${prefix}/${id}`);
    },
    [router]
  );

  const handlePlaceHover = useCallback((placeKey: string | null) => {
    setHoveredPlaceKey(placeKey);
  }, []);

  const handleMapMarkerClick = useCallback((placeKey: string) => {
    setSelectedPlaceKey(placeKey);
    // The sidebar will auto-scroll to this card
  }, []);

  const handleSearchSubmit = useCallback(() => {
    // Update URL with search query
    const params = new URLSearchParams(searchParams.toString());
    params.set("q", searchQuery);
    router.push(`/map?${params.toString()}`);
    // Trigger search
    searchArea(searchQuery);
  }, [searchQuery, searchParams, router, searchArea]);

  const handleSearchThisArea = useCallback(() => {
    searchArea(searchQuery);
  }, [searchArea, searchQuery]);

  const handleResetView = useCallback(() => {
    setMapCenter(initialCenter);
    setMapZoom(initialZoom);
  }, [initialCenter, initialZoom]);

  const capitalizedQuery = searchQuery
    ? searchQuery.charAt(0).toUpperCase() + searchQuery.slice(1)
    : "Places";
  const capitalizedCity = initialCity.charAt(0).toUpperCase() + initialCity.slice(1);
  const title = `${capitalizedQuery} near ${capitalizedCity}`;
  const subtitle = `Showing ${sidebarPlaces.length} results`;

  return (
    <div className="flex h-dvh flex-col">
      {/* ── Top navigation bar (Yelp-style) ── */}
      <header className="z-20 flex-shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 items-center gap-4 px-4">
          {/* Logo / home link */}
          <Link
            href="/"
            className="flex-shrink-0 text-lg font-bold text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
          >
            Morocco Eats
          </Link>

          {/* Center search bar */}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearchSubmit();
              }}
              className="flex w-full max-w-2xl items-center overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm transition-shadow focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-400/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus-within:border-orange-500 dark:focus-within:ring-orange-500/20"
            >
              {/* "What" field */}
              <div className="relative flex flex-1 items-center border-r border-zinc-300 dark:border-zinc-700">
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Restaurants, tagine, cafes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>

              {/* "Where" field */}
              <div className="relative hidden flex-1 items-center sm:flex">
                <MapPin className="pointer-events-none absolute left-3 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Current map area"
                  value={capitalizedCity}
                  readOnly
                  className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>

              {/* Submit button */}
              <Button
                type="submit"
                size="icon"
                className="m-1 h-8 w-8 flex-shrink-0 rounded-md bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600"
              >
                <Search className="h-4 w-4" />
                <span className="sr-only">Search</span>
              </Button>
            </form>
          </div>

          {/* Right-side nav links */}
          <nav className="hidden flex-shrink-0 items-center gap-3 md:flex">
            <Link
              href="/guides"
              className="text-sm text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Guides
            </Link>
            <Link
              href="/signin"
              className="rounded-full bg-orange-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600"
            >
              Sign In
            </Link>
          </nav>

          {/* Mobile map/list toggle */}
          <div className="lg:hidden">
            <MapListToggle view={mobileView} onViewChange={setMobileView} />
          </div>
        </div>
      </header>

      {/* ── Content: sidebar + map ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Sidebar (left) - hidden on mobile when map view */}
        <aside
          className={cn(
            "flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800",
            // Desktop: always visible, fixed width
            "hidden lg:flex lg:w-[420px]",
            // Mobile: full width when list view
            mobileView === "list" && "flex flex-1 lg:flex-none"
          )}
        >
          <PlaceListSidebar
            places={sidebarPlaces}
            isLoading={isSearching && searchResults.length === 0}
            selectedPlaceKey={selectedPlaceKey}
            hoveredPlaceKey={hoveredPlaceKey}
            onPlaceClick={handlePlaceClick}
            onPlaceHover={handlePlaceHover}
            title={title}
            subtitle={subtitle}
            showHeader={false}
            className="w-full"
          />
        </aside>

        {/* Map (right) - hidden on mobile when list view */}
        <main
          className={cn(
            "relative flex-1",
            // Mobile: hidden when list view
            mobileView === "list" && "hidden lg:block",
            // Expanded mode
            isMapExpanded && "lg:fixed lg:inset-0 lg:z-50"
          )}
        >
          <MapView
            places={mapPlaces}
            center={mapCenter}
            zoom={mapZoom}
            onBoundsChange={handleBoundsChange}
            onPlaceClick={handleMapMarkerClick}
            enableClustering={mapPlaces.length > 50}
            className="h-full w-full"
            highlightedPlaceKey={hoveredPlaceKey}
            selectedPlaceKey={selectedPlaceKey}
            showIndices={true}
          />

          {/* Map overlay controls */}
          <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
            {/* Search this area button */}
            {showSearchButton && (
              <SearchThisAreaButton
                onClick={handleSearchThisArea}
                isLoading={isSearching}
                disabled={isOnCooldown}
                cooldownRemaining={cooldownRemaining}
              />
            )}
          </div>

          {/* Right side controls */}
          <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
            {/* Expand/collapse map (desktop only) */}
            <Button
              variant="secondary"
              size="icon"
              className="hidden h-10 w-10 bg-white shadow-md hover:bg-zinc-50 lg:flex dark:bg-zinc-800 dark:hover:bg-zinc-700"
              onClick={() => setIsMapExpanded(!isMapExpanded)}
            >
              {isMapExpanded ? (
                <Shrink className="h-4 w-4" />
              ) : (
                <Expand className="h-4 w-4" />
              )}
            </Button>

            {/* Reset view */}
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 bg-white shadow-md hover:bg-zinc-50 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              onClick={handleResetView}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* Bottom info bar */}
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <div className="rounded-lg bg-white/95 px-4 py-2 shadow-lg backdrop-blur-sm dark:bg-zinc-900/95">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {sidebarPlaces.length} places found
                </span>
                {selectedPlaceKey && (
                  <button
                    onClick={() => setSelectedPlaceKey(null)}
                    className="text-orange-600 hover:text-orange-700 dark:text-orange-500 dark:hover:text-orange-400"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Hovered place preview (when hovering sidebar card) */}
          {hoveredPlaceKey && !selectedPlaceKey && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2">
              <div className="rounded-lg bg-white px-4 py-2 shadow-xl dark:bg-zinc-800">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {sidebarPlaces.find((p) => p.placeKey === hoveredPlaceKey)?.name}
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Escape expanded map */}
        {isMapExpanded && (
          <button
            className="fixed left-4 top-4 z-[60] rounded-lg bg-white px-4 py-2 font-medium shadow-lg hover:bg-zinc-50 lg:block dark:bg-zinc-800 dark:hover:bg-zinc-700"
            onClick={() => setIsMapExpanded(false)}
          >
            ← Back to list
          </button>
        )}
      </div>
    </div>
  );
}
