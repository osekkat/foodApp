"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

export function CityPicker() {
  const cities = useQuery(api.cities.getFeatured);

  if (cities === undefined) {
    return <CityPickerSkeleton />;
  }

  if (!cities || cities.length === 0) {
    return null;
  }

  // Sort by sortOrder
  const sortedCities = [...cities].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="mb-16">
      <h3 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Explore by City
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {sortedCities.map((city) => (
          <Link
            key={city._id}
            href={`/search?city=${city.slug}`}
            className="group flex flex-col items-center rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
          >
            <span className="text-lg font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
              {city.name}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{city.nameAr}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CityPickerSkeleton() {
  return (
    <section className="mb-16">
      <Skeleton className="mb-6 h-7 w-36" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Skeleton className="h-6 w-20 mb-2" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </section>
  );
}
