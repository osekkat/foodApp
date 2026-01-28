"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSearch } from "@/hooks/useSearch";
import { SearchHeader } from "./SearchHeader";
import { SearchInput } from "./SearchInput";
import { PopularSearches } from "./PopularSearches";
import { SearchResults } from "./SearchResults";
import { SearchEmptyState } from "./SearchEmptyState";
import { SearchResultsSkeleton } from "./SearchResultsSkeleton";

export interface CityData {
  _id: string;
  name: string;
  nameAr: string;
  nameFr: string;
  slug: string;
  lat: number;
  lng: number;
  defaultZoom: number;
  boundingBox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface SearchPageClientProps {
  city?: CityData;
  initialQuery?: string;
}

export function SearchPageClient({ city, initialQuery = "" }: SearchPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [activeQuery, setActiveQuery] = useState(initialQuery);

  // Use the search hook with location bias from city
  const {
    query,
    setQuery,
    suggestions,
    isLoading: isAutocompleteLoading,
    error: autocompleteError,
    isDegraded,
    selectPlace,
    clear,
    isAutocompleteEnabled,
  } = useSearch({
    locationBias: city
      ? { lat: city.lat, lng: city.lng, radiusMeters: 50000 }
      : undefined,
    minQueryLength: 2,
    debounceMs: 300,
    includedPrimaryTypes: ["restaurant", "cafe", "bakery", "food"],
    language: "en",
  });

  // Search owned content when we have an active query
  const ownedSearchResults = useQuery(
    api.search.searchOwned,
    activeQuery.trim().length >= 2
      ? {
          query: activeQuery,
          city: city?.slug,
          limit: 10,
          includeTypes: ["curated", "guide", "dish"],
        }
      : "skip"
  );

  // Sync active query with URL
  useEffect(() => {
    const urlQuery = searchParams.get("q") || "";
    if (urlQuery !== activeQuery) {
      setActiveQuery(urlQuery);
      setQuery(urlQuery);
    }
  }, [searchParams, setQuery, activeQuery]);

  // Update URL when query changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (query !== activeQuery) {
        setActiveQuery(query);
        const params = new URLSearchParams(searchParams.toString());
        if (query) {
          params.set("q", query);
        } else {
          params.delete("q");
        }
        const newUrl = `?${params.toString()}`;
        router.replace(newUrl, { scroll: false });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [query, activeQuery, router, searchParams]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isInputFocused || suggestions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            handleSelectSuggestion(suggestions[selectedIndex].placeId);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsInputFocused(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isInputFocused, suggestions, selectedIndex]
  );

  // Handle selecting a suggestion
  const handleSelectSuggestion = useCallback(
    async (placeId: string) => {
      await selectPlace(placeId);
      setIsInputFocused(false);
      setSelectedIndex(-1);
      // Navigate to place detail page
      router.push(`/place/g/${placeId}`);
    },
    [selectPlace, router]
  );

  // Handle selecting a popular/recent search
  const handleSelectSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      setActiveQuery(searchQuery);
    },
    [setQuery]
  );

  // Handle clear
  const handleClear = useCallback(() => {
    clear();
    setActiveQuery("");
    setSelectedIndex(-1);
  }, [clear]);

  // Determine what to show
  const showPopularSearches = !activeQuery.trim();
  const showAutocompleteDropdown = isInputFocused && isAutocompleteEnabled;
  const showResults = activeQuery.trim().length >= 2 && !isInputFocused;
  const isLoadingResults = ownedSearchResults === undefined && activeQuery.trim().length >= 2;

  const hasAnyResults =
    suggestions.length > 0 ||
    (ownedSearchResults?.results && ownedSearchResults.results.length > 0);

  const showEmptyState =
    showResults &&
    !isLoadingResults &&
    !hasAnyResults &&
    activeQuery.trim().length >= 2;

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <SearchHeader cityName={city?.name} cityNameAr={city?.nameAr} />

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Search Input */}
        <SearchInput
          query={query}
          onQueryChange={setQuery}
          suggestions={suggestions}
          isLoading={isAutocompleteLoading}
          isDegraded={isDegraded}
          error={autocompleteError}
          isOpen={showAutocompleteDropdown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => setIsInputFocused(false), 150);
          }}
          onSelectSuggestion={handleSelectSuggestion}
          onClear={handleClear}
          selectedIndex={selectedIndex}
          onKeyDown={handleKeyDown}
        />

        {/* Content Area */}
        <div className="mt-8">
          {showPopularSearches && (
            <PopularSearches
              city={city?.slug}
              onSelectSearch={handleSelectSearch}
            />
          )}

          {isLoadingResults && <SearchResultsSkeleton />}

          {showResults && !isLoadingResults && hasAnyResults && (
            <SearchResults
              providerSuggestions={suggestions}
              ownedResults={ownedSearchResults?.results || []}
              query={activeQuery}
            />
          )}

          {showEmptyState && (
            <SearchEmptyState query={activeQuery} cityName={city?.name} />
          )}
        </div>
      </div>
    </div>
  );
}
