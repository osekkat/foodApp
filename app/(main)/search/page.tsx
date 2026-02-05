import { Suspense } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SearchPageClient, type CityData } from "@/components/search";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Search",
  description: "Search for restaurants and food in Morocco",
};

// Force dynamic rendering since we need to read searchParams
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{
    city?: string;
  }>;
}

async function SearchPageContent({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const citySlug = params.city;

  // Fetch city data if city slug is provided
  let city: CityData | undefined;
  if (citySlug) {
    try {
      const cityData = await fetchQuery(api.cities.getBySlug, { slug: citySlug });
      if (cityData) {
        city = cityData as CityData;
      }
    } catch (error) {
      console.error("Failed to fetch city data:", error);
    }
  }

  return <SearchPageClient city={city} />;
}

function SearchPageSkeleton() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Header Skeleton */}
      <div className="border-b border-zinc-200 bg-gradient-to-br from-orange-50 to-white dark:border-zinc-800 dark:from-zinc-900 dark:to-black">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-9 w-48" />
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="mt-8 space-y-8">
          <div>
            <Skeleton className="h-4 w-32 mb-4" />
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage(props: SearchPageProps) {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageContent {...props} />
    </Suspense>
  );
}
