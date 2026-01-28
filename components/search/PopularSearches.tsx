"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Clock, TrendingUp, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface PopularSearch {
  query: string;
  count: number;
}

interface RecentSearch {
  query: string;
  normalizedQuery: string;
  city?: string;
  searchedAt: number;
}

export interface PopularSearchesProps {
  city?: string;
  onSelectSearch: (query: string) => void;
}

export function PopularSearches({ city, onSelectSearch }: PopularSearchesProps) {
  const popularSearches = useQuery(api.popularSearches.getPopularSearches, {
    city: city ?? "global",
    limit: 8,
  }) as PopularSearch[] | undefined;

  const recentSearches = useQuery(api.popularSearches.getMyRecentSearches, {
    limit: 5,
  }) as RecentSearch[] | undefined;

  const clearHistory = useMutation(api.popularSearches.clearMySearchHistory);

  const handleClearHistory = async () => {
    await clearHistory();
  };

  const isLoading = popularSearches === undefined;

  if (isLoading) {
    return <PopularSearchesSkeleton />;
  }

  const hasRecentSearches = recentSearches && recentSearches.length > 0;
  const hasPopularSearches = popularSearches && popularSearches.length > 0;

  if (!hasRecentSearches && !hasPopularSearches) {
    return (
      <div className="text-center py-8">
        <p className="text-zinc-500 dark:text-zinc-400">
          Start typing to search for restaurants, dishes, or guides
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Recent Searches */}
      {hasRecentSearches && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Recent Searches
            </h3>
            <button
              onClick={handleClearHistory}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((search) => (
              <button
                key={`${search.query}-${search.searchedAt}`}
                onClick={() => onSelectSearch(search.query)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                <Clock className="h-3 w-3" />
                {search.query}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Popular Searches */}
      {hasPopularSearches && (
        <section>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-4">
            Trending
          </h3>
          <div className="flex flex-wrap gap-2">
            {popularSearches.map((search) => (
              <button
                key={search.query}
                onClick={() => onSelectSearch(search.query)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-50 text-sm text-orange-700 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:hover:bg-orange-900/30 transition-colors"
              >
                <TrendingUp className="h-3 w-3" />
                {search.query}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PopularSearchesSkeleton() {
  return (
    <div className="space-y-8">
      <section>
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </section>
      <section>
        <Skeleton className="h-4 w-24 mb-4" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
