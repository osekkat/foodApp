"use client";

import { useMemo } from "react";
import { ProviderResultCard } from "./ProviderResultCard";
import { OwnedResultCard, type OwnedResult } from "./OwnedResultCard";
import type { AutocompleteResult } from "@/lib/searchSession";

export interface SearchResultsProps {
  providerSuggestions: AutocompleteResult[];
  ownedResults: OwnedResult[];
  query: string;
}

export function SearchResults({
  providerSuggestions,
  ownedResults,
  query,
}: SearchResultsProps) {
  // Separate owned results by type
  const { curatedAndGuides, dishes } = useMemo(() => {
    const curatedAndGuides: OwnedResult[] = [];
    const dishes: OwnedResult[] = [];

    for (const result of ownedResults) {
      if (result.type === "curated" || result.type === "guide") {
        curatedAndGuides.push(result);
      } else if (result.type === "dish") {
        dishes.push(result);
      }
    }

    return { curatedAndGuides, dishes };
  }, [ownedResults]);

  const hasCuratedAndGuides = curatedAndGuides.length > 0;
  const hasProviderSuggestions = providerSuggestions.length > 0;
  const hasDishes = dishes.length > 0;

  return (
    <div className="space-y-8">
      {/* Owned Content Section (Curated + Guides) */}
      {hasCuratedAndGuides && (
        <section>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
            From Our Guides
          </h3>
          <div className="space-y-3">
            {curatedAndGuides.map((result) => (
              <OwnedResultCard key={`${result.type}-${result.id}`} result={result} />
            ))}
          </div>
        </section>
      )}

      {/* Provider Suggestions Section */}
      {hasProviderSuggestions && (
        <section>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
            Places
          </h3>
          <div className="space-y-2">
            {providerSuggestions.map((suggestion) => (
              <ProviderResultCard
                key={suggestion.placeId}
                suggestion={suggestion}
              />
            ))}
          </div>
        </section>
      )}

      {/* Dishes Section */}
      {hasDishes && (
        <section>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
            Popular Dishes
          </h3>
          <div className="space-y-2">
            {dishes.map((result) => (
              <OwnedResultCard key={`${result.type}-${result.id}`} result={result} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
