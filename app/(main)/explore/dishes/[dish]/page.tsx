"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, ArrowLeft, MapPin, Heart, Star, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dish Explorer result place type
 */
interface DishExplorerPlace {
  placeKey: string;
  dish: string;
  dishMentions: number;
  lastMentionedAt: number;
  favoritesCount: number;
  recentReviewCount: number;
  communityRating?: number;
  communityRatingCount: number;
  curatedTitle?: string;
  curatedSummary?: string;
  curatedNeighborhood?: string;
  curatedMustTry?: string[];
  isCurated: boolean;
  city?: string;
  dishScore: number;
}

interface DishExplorerResult {
  places: DishExplorerPlace[];
  dish: string;
  totalCount: number;
}

/**
 * Dish Explorer page - Find the best places for a specific dish
 *
 * This feature differentiates us from Google:
 * - We can tell you "where to get the best tagine in Gueliz"
 * - Ranking uses owned signals (dish mentions, reviews, favorites)
 * - Works in degraded mode (no provider dependency)
 */
export default function DishExplorerPage() {
  const params = useParams<{ dish: string }>();
  const rawDish = params.dish ?? "";

  // Safely decode URI component (handles malformed URIs)
  let dish: string;
  try {
    dish = decodeURIComponent(rawDish);
  } catch {
    dish = rawDish; // Fallback to raw value if decoding fails
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(api.tags.exploreDish as any, {
    dish,
    limit: 20,
  }) as DishExplorerResult | undefined;

  // Format dish name for display
  const displayName = dish.charAt(0).toUpperCase() + dish.slice(1);

  // Loading state
  if (result === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-orange-50 to-white dark:from-zinc-900 dark:to-black">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
          <p className="text-zinc-600 dark:text-zinc-400">
            Finding the best places for {displayName}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white dark:from-zinc-900 dark:to-black">
      {/* Header */}
      <header className="border-b border-orange-100 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              Best {displayName} in Morocco
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Results summary */}
        <div className="mb-6 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Utensils className="h-4 w-4" />
          <span>
            {result.totalCount} place{result.totalCount !== 1 ? "s" : ""} found for {displayName}
          </span>
        </div>

        {/* No results */}
        {result.places.length === 0 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-800">
            <Utensils className="mx-auto mb-4 h-12 w-12 text-zinc-400" />
            <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              No places found for {displayName}
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              Be the first to recommend a place! Leave a review and mention this dish.
            </p>
            <Link href="/map">
              <Button>Search for places</Button>
            </Link>
          </div>
        )}

        {/* Results grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.places.map((place) => (
            <PlaceCard key={place.placeKey} place={place} dish={displayName} />
          ))}
        </div>
      </main>
    </div>
  );
}

interface PlaceCardProps {
  place: DishExplorerPlace;
  dish: string;
}

function PlaceCard({ place, dish }: PlaceCardProps) {
  // Determine link path based on placeKey format
  const getLinkPath = (placeKey: string) => {
    if (placeKey.startsWith("g:")) {
      return `/place/g/${placeKey.slice(2)}`;
    }
    if (placeKey.startsWith("c:")) {
      return `/place/c/${placeKey.slice(2)}`;
    }
    return `/place/${placeKey}`;
  };

  return (
    <Link
      href={getLinkPath(place.placeKey)}
      className="group rounded-lg border border-zinc-200 bg-white p-4 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
    >
      {/* Title and curated badge */}
      <div className="mb-2 flex items-start justify-between">
        <h3 className="font-semibold text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
          {place.curatedTitle || `Place ${place.placeKey.slice(0, 10)}...`}
        </h3>
        {place.isCurated && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
            Curated
          </span>
        )}
      </div>

      {/* Neighborhood */}
      {place.curatedNeighborhood && (
        <div className="mb-2 flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <MapPin className="h-3 w-3" />
          <span>{place.curatedNeighborhood}</span>
        </div>
      )}

      {/* Summary */}
      {place.curatedSummary && (
        <p className="mb-3 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
          {place.curatedSummary}
        </p>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        {/* Dish mentions */}
        <div className="flex items-center gap-1" title={`${place.dishMentions} mentions of ${dish}`}>
          <Utensils className="h-3 w-3 text-orange-500" />
          <span>{place.dishMentions} mentions</span>
        </div>

        {/* Favorites */}
        {place.favoritesCount > 0 && (
          <div className="flex items-center gap-1" title={`${place.favoritesCount} favorites`}>
            <Heart className="h-3 w-3 text-red-500" />
            <span>{place.favoritesCount}</span>
          </div>
        )}

        {/* Community rating */}
        {place.communityRating && place.communityRatingCount > 0 && (
          <div
            className="flex items-center gap-1"
            title={`${place.communityRating.toFixed(1)} from ${place.communityRatingCount} reviews`}
          >
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            <span>
              {place.communityRating.toFixed(1)} ({place.communityRatingCount})
            </span>
          </div>
        )}
      </div>

      {/* Must try items if they include this dish */}
      {place.curatedMustTry && place.curatedMustTry.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-700">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Must try:
          </p>
          <div className="flex flex-wrap gap-1">
            {place.curatedMustTry.slice(0, 3).map((item, i) => (
              <span
                key={i}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </Link>
  );
}
