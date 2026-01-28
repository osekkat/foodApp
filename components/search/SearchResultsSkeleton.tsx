"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function SearchResultsSkeleton() {
  return (
    <div className="space-y-8">
      {/* Section 1 */}
      <section>
        <Skeleton className="h-4 w-28 mb-3" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700"
            >
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 */}
      <section>
        <Skeleton className="h-4 w-16 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700"
            >
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
