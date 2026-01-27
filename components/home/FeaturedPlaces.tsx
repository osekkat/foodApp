"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface FeaturedPlacesProps {
  city?: string;
}

export function FeaturedPlaces({ city = "marrakech" }: FeaturedPlacesProps) {
  const places = useQuery(api.curatedPlaces.getFeaturedPlaces, { city, limit: 6 });

  if (places === undefined) {
    return <FeaturedPlacesSkeleton />;
  }

  if (!places || places.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <h3 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Featured Places
      </h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {places.map((place) => (
          <Link
            key={place._id}
            href={`/place/c/${place.slug}`}
            className="group overflow-hidden rounded-xl border border-zinc-200 bg-white transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
          >
            <div className="aspect-video bg-zinc-100 dark:bg-zinc-700">
              {/* Placeholder for cover image */}
            </div>
            <div className="p-4">
              <h4 className="font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
                {place.title}
              </h4>
              {place.neighborhood && (
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {place.neighborhood}
                </p>
              )}
              {place.tags && place.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {place.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
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
        ))}
      </div>
    </section>
  );
}

function FeaturedPlacesSkeleton() {
  return (
    <section className="mb-16">
      <Skeleton className="mb-6 h-7 w-40" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Skeleton className="aspect-video" />
            <div className="p-4">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
