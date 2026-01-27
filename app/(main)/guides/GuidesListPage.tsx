"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, ArrowLeft } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

interface GuidesListPageProps {
  initialGuides: Doc<"guides">[];
}

export function GuidesListPage({ initialGuides }: GuidesListPageProps) {
  // Re-fetch for real-time updates
  const guides = useQuery(api.guides.list, { locale: "en", limit: 50 }) ?? initialGuides;

  const featuredGuides = guides.filter((g) => g.featured);
  const otherGuides = guides.filter((g) => !g.featured);

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-gradient-to-br from-orange-50 to-white dark:border-zinc-800 dark:from-zinc-900 dark:to-black">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 sm:text-4xl">
            Curated Food Guides
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-300">
            Discover the best food experiences in Morocco. Our local editors curate the top spots
            for tagine, couscous, seafood, and more.
          </p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Featured Guides */}
        {featuredGuides.length > 0 && (
          <section className="mb-16">
            <h2 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Featured Guides
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featuredGuides.map((guide) => (
                <GuideCard key={guide._id} guide={guide} featured />
              ))}
            </div>
          </section>
        )}

        {/* All Guides */}
        {otherGuides.length > 0 && (
          <section>
            <h2 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              All Guides
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {otherGuides.map((guide) => (
                <GuideCard key={guide._id} guide={guide} />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {guides.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
              <span className="text-3xl">📖</span>
            </div>
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              No guides yet
            </h3>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              We&apos;re working on curating the best food guides for you. Check back soon!
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function GuideCard({ guide, featured = false }: { guide: Doc<"guides">; featured?: boolean }) {
  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="group overflow-hidden rounded-xl border border-zinc-200 bg-white transition-all hover:border-orange-300 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
    >
      <div className="relative aspect-[16/10] bg-zinc-100 dark:bg-zinc-700">
        {guide.coverImageUrl ? (
          <Image
            src={guide.coverImageUrl}
            alt={guide.title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/30">
            <span className="text-5xl">📖</span>
          </div>
        )}
        {featured && (
          <div className="absolute left-3 top-3">
            <Badge className="bg-orange-500 text-white">Featured</Badge>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 text-lg font-semibold text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
          {guide.title}
        </h3>
        {guide.city && (
          <p className="mt-1 flex items-center text-sm capitalize text-zinc-500 dark:text-zinc-400">
            <MapPin className="mr-1 h-3 w-3" />
            {guide.city}
          </p>
        )}
        <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
          {guide.description}
        </p>
        <div className="mt-3 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>{guide.placeKeys.length} places</span>
        </div>
      </div>
    </Link>
  );
}

export function GuidesListSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
        >
          <Skeleton className="aspect-[16/10]" />
          <div className="p-4">
            <Skeleton className="mb-2 h-6 w-full" />
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-1 h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
