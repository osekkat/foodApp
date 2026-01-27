"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";

interface FeaturedGuidesProps {
  city?: string;
  locale?: string;
  limit?: number;
}

export function FeaturedGuides({ city, locale = "en", limit = 4 }: FeaturedGuidesProps) {
  const guides = useQuery(api.guides.getFeaturedGuides, { city, locale, limit });

  if (guides === undefined) {
    return <FeaturedGuidesSkeleton />;
  }

  if (!guides || guides.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Curated Guides
        </h3>
        <Link
          href="/guides"
          className="text-sm font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
        >
          View all
        </Link>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {guides.map((guide) => (
          <Link
            key={guide._id}
            href={`/guides/${guide.slug}`}
            className="group overflow-hidden rounded-xl border border-zinc-200 bg-white transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
          >
            <div className="relative aspect-[16/10] bg-zinc-100 dark:bg-zinc-700">
              {guide.coverImageUrl ? (
                <Image
                  src={guide.coverImageUrl}
                  alt={guide.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-4xl">📖</span>
                </div>
              )}
            </div>
            <div className="p-4">
              <h4 className="line-clamp-2 font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
                {guide.title}
              </h4>
              {guide.city && (
                <p className="mt-1 text-sm capitalize text-zinc-500 dark:text-zinc-400">
                  {guide.city}
                </p>
              )}
              <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                {guide.description}
              </p>
              <div className="mt-3 flex items-center text-xs text-zinc-500 dark:text-zinc-400">
                <span>{guide.placeKeys.length} places</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FeaturedGuidesSkeleton() {
  return (
    <section className="mb-16">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Skeleton className="aspect-[16/10]" />
            <div className="p-4">
              <Skeleton className="mb-2 h-5 w-full" />
              <Skeleton className="mb-2 h-4 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
