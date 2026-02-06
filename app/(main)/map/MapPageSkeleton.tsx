"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the map page
 * Shows the Yelp-style layout structure while data loads
 */
export function MapPageSkeleton() {
  return (
    <div className="flex h-dvh flex-col">
      {/* Top navigation bar skeleton */}
      <header className="z-20 flex-shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 items-center gap-4 px-4">
          {/* Logo */}
          <Skeleton className="h-6 w-28 flex-shrink-0" />

          {/* Search bar */}
          <div className="flex flex-1 justify-center">
            <Skeleton className="h-10 w-full max-w-2xl rounded-lg" />
          </div>

          {/* Right links */}
          <div className="hidden items-center gap-3 md:flex">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </div>
      </header>

      {/* Content: sidebar + map */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Sidebar skeleton */}
        <aside className="hidden w-[420px] flex-shrink-0 border-r border-zinc-200 bg-zinc-50 lg:flex lg:flex-col dark:border-zinc-800 dark:bg-zinc-950">
          {/* Results count + filters */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-28 rounded-md" />
            </div>
          </div>

          {/* Place cards skeleton */}
          <div className="flex-1 overflow-hidden p-4">
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="flex gap-4">
                    <Skeleton className="h-24 w-24 flex-shrink-0 rounded-lg sm:h-28 sm:w-28" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                      <div className="mt-auto flex gap-2">
                        <Skeleton className="h-5 w-16 rounded-full" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Map skeleton */}
        <main className="relative flex-1 bg-zinc-200 dark:bg-zinc-800">
          {/* Map placeholder */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-12 w-12 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>

          {/* Overlay controls skeleton */}
          <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>

          {/* Bottom bar skeleton */}
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </main>
      </div>
    </div>
  );
}
