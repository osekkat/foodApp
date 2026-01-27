"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MapPin, Star, Heart } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";

interface GuidePageProps {
  initialGuide: Doc<"guides">;
  slug: string;
}

type PlaceData =
  | {
      placeKey: string;
      type: "curated";
      title: string;
      summary: string;
      mustTry?: string[];
      priceNote?: string;
      neighborhood?: string;
      coverStorageId?: Id<"_storage">;
    }
  | {
      placeKey: string;
      type: "provider";
      favoritesCount: number;
      communityRatingAvg?: number;
      communityRatingCount: number;
    }
  | {
      placeKey: string;
      type: "unknown";
    };

export function GuidePage({ initialGuide, slug }: GuidePageProps) {
  // Re-fetch for real-time updates if user navigates back
  const guide = useQuery(api.guides.getBySlug, { slug }) ?? initialGuide;
  const places = useQuery(api.guides.getGuidePlaces, { guideId: initialGuide._id });

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Hero Section */}
      <div className="relative">
        {guide.coverImageUrl ? (
          <div className="relative h-64 sm:h-80 md:h-96">
            <Image
              src={guide.coverImageUrl}
              alt={guide.title}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          </div>
        ) : (
          <div className="h-64 bg-gradient-to-br from-orange-400 to-orange-600 sm:h-80 md:h-96" />
        )}

        {/* Back link */}
        <div className="absolute left-4 top-4 z-10 sm:left-6">
          <Link
            href="/guides"
            className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:bg-white dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" />
            All Guides
          </Link>
        </div>

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-4xl">
            {guide.city && (
              <Badge
                variant="secondary"
                className="mb-2 bg-white/90 text-zinc-900 dark:bg-zinc-800/90 dark:text-zinc-100"
              >
                <MapPin className="mr-1 h-3 w-3" />
                {guide.city}
              </Badge>
            )}
            <h1 className="text-2xl font-bold text-white drop-shadow-md sm:text-3xl lg:text-4xl">
              {guide.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Description */}
        <p className="text-lg text-zinc-600 dark:text-zinc-300">{guide.description}</p>

        {/* Stats */}
        <div className="mt-6 flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{guide.placeKeys.length} places</span>
          <span>|</span>
          <span className="capitalize">{guide.locale}</span>
        </div>

        {/* Places List */}
        <div className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Places in this Guide
          </h2>

          {places === undefined ? (
            <PlacesListSkeleton count={guide.placeKeys.length} />
          ) : (
            <div className="space-y-4">
              {places.map((place, index) => (
                <PlaceCard key={place.placeKey} place={place} index={index + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaceCard({ place, index }: { place: PlaceData; index: number }) {
  // Construct proper URL based on placeKey format:
  // - "c:slug" -> /place/c/slug
  // - "g:ChIJ..." -> /place/g/ChIJ...
  const href = place.placeKey.startsWith("c:")
    ? `/place/c/${place.placeKey.slice(2)}`
    : place.placeKey.startsWith("g:")
      ? `/place/g/${place.placeKey.slice(2)}`
      : `/place/${encodeURIComponent(place.placeKey)}`; // Fallback for unknown formats

  if (place.type === "curated") {
    return (
      <Link
        href={href}
        className="group flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
            {place.title}
          </h3>
          {place.neighborhood && (
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              <MapPin className="mr-1 inline-block h-3 w-3" />
              {place.neighborhood}
            </p>
          )}
          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
            {place.summary}
          </p>
          {place.mustTry && place.mustTry.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {place.mustTry.slice(0, 3).map((dish) => (
                <Badge key={dish} variant="outline" className="text-xs">
                  {dish}
                </Badge>
              ))}
            </div>
          )}
          {place.priceNote && (
            <p className="mt-2 text-sm font-medium text-orange-600 dark:text-orange-400">
              {place.priceNote}
            </p>
          )}
        </div>
      </Link>
    );
  }

  if (place.type === "provider") {
    return (
      <Link
        href={href}
        className="group flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
            View Place Details
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Provider place - details loaded on visit
          </p>
          <div className="mt-2 flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
            {place.communityRatingAvg !== undefined && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                {place.communityRatingAvg.toFixed(1)} ({place.communityRatingCount})
              </span>
            )}
            {place.favoritesCount > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-4 w-4 text-red-500" />
                {place.favoritesCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Unknown place
  return (
    <div className="flex gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
        {index}
      </div>
      <div className="flex-1">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Place data not available yet
        </p>
        <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-500">
          {place.placeKey}
        </p>
      </div>
    </div>
  );
}

function PlacesListSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1">
            <Skeleton className="mb-2 h-5 w-48" />
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
